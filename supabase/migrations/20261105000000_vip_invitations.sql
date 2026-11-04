-- Private VIP table invitations. Issued by a super admin only, never sold.
-- Deliberately separate from tiers, orders, tickets, checkout holds, promotions,
-- and Stripe. Nothing here changes public inventory, revenue, or the ticket scanner path.
--
-- One invitation = one group = one opaque credential. Capacity is 1 to 6 and is
-- enforced by a check constraint. Admissions are counted with one conditional
-- UPDATE, so concurrent door scans cannot admit more than the capacity.

set lock_timeout = '4s';
set statement_timeout = '60s';

create table public.vip_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id text not null check (event_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  table_label text not null check (char_length(btrim(table_label)) between 1 and 40),
  host_name text not null check (char_length(btrim(host_name)) between 2 and 80),
  email text not null check (char_length(email) between 3 and 320 and position('@' in email) > 1),
  phone text check (phone is null or char_length(phone) between 7 and 40),
  admin_note text check (admin_note is null or char_length(admin_note) <= 200),
  capacity int not null check (capacity between 1 and 6),
  admitted int not null default 0 check (admitted >= 0),
  status text not null default 'issued'
    check (status in ('issued', 'partially_admitted', 'fully_admitted', 'revoked', 'cancelled')),
  -- The only thing the QR code contains. Opaque; carries no name, email, id, or capacity.
  token text not null unique default ('vip_' || encode(extensions.gen_random_bytes(24), 'hex'))
    check (token ~ '^vip_[0-9a-f]{48}$'),
  -- Human reference printed under the code, e.g. VIP-7K9M4Q.
  code text not null unique check (code ~ '^VIP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  issued_by uuid references auth.users (id) on delete set null,
  email_sent_at timestamptz,
  email_count int not null default 0 check (email_count >= 0),
  last_entry_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vip_invitations_admitted_within_capacity check (admitted <= capacity),
  constraint vip_invitations_status_matches_count check (
    (status = 'issued' and admitted = 0)
    or (status = 'partially_admitted' and admitted > 0 and admitted < capacity)
    or (status = 'fully_admitted' and admitted = capacity)
    or status in ('revoked', 'cancelled')
  ),
  constraint vip_invitations_revoked_stamp check ((status = 'revoked') = (revoked_at is not null))
);

create index vip_invitations_event_idx on public.vip_invitations (event_id, created_at desc);

-- One live invitation per table label per event, so a double submit cannot
-- create a second group for the same table.
create unique index vip_invitations_live_table_idx
  on public.vip_invitations (event_id, lower(btrim(table_label)))
  where status in ('issued', 'partially_admitted', 'fully_admitted');

create table public.vip_admissions (
  id bigint generated always as identity primary key,
  invitation_id uuid not null references public.vip_invitations (id) on delete restrict,
  guests int not null check (guests between 1 and 6),
  admitted_after int not null check (admitted_after between 1 and 6),
  scanned_by text not null check (char_length(scanned_by) between 1 and 320),
  device text check (device is null or char_length(device) <= 60),
  created_at timestamptz not null default now()
);

create index vip_admissions_invitation_idx on public.vip_admissions (invitation_id, created_at);

alter table public.vip_invitations enable row level security;
alter table public.vip_admissions enable row level security;
alter table public.vip_invitations force row level security;
alter table public.vip_admissions force row level security;

-- No policies: anon and authenticated are denied. Edge Functions use service_role.
revoke all on public.vip_invitations, public.vip_admissions from public, anon, authenticated;
revoke all on sequence public.vip_admissions_id_seq from public, anon, authenticated;

-- An invitation is never deleted, never re-pointed, and never grows. Revoked
-- and cancelled are final. Admissions only move forward, and only while live.
create or replace function public.guard_vip_invitation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'vip_invitations rows are kept for history';
  end if;
  if new.id <> old.id
     or new.event_id <> old.event_id
     or new.token <> old.token
     or new.code <> old.code
     or new.capacity <> old.capacity
     or new.idempotency_key <> old.idempotency_key
     or new.issued_by is distinct from old.issued_by
     or new.created_at <> old.created_at then
    raise exception 'vip invitation identity and capacity are immutable';
  end if;
  if new.admitted < old.admitted then
    raise exception 'vip admissions cannot be reversed';
  end if;
  if old.status in ('revoked', 'cancelled') and (new.status <> old.status or new.admitted <> old.admitted) then
    raise exception 'vip invitation is final';
  end if;
  if new.admitted > old.admitted and old.status not in ('issued', 'partially_admitted') then
    raise exception 'vip invitation is not admitting';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger vip_invitations_guard
  before update or delete on public.vip_invitations
  for each row execute function public.guard_vip_invitation();

create trigger vip_invitations_no_truncate
  before truncate on public.vip_invitations
  for each statement execute function public.reject_audit_mutation();

create or replace function public.reject_vip_admission_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'vip_admissions is append-only';
end;
$$;

create trigger vip_admissions_append_only
  before update or delete on public.vip_admissions
  for each row execute function public.reject_vip_admission_change();

create trigger vip_admissions_no_truncate
  before truncate on public.vip_admissions
  for each statement execute function public.reject_vip_admission_change();

-- Idempotent on p_idempotency_key: a retried send returns the same invitation.
create or replace function public.issue_vip_invitation(
  p_event_id text,
  p_table_label text,
  p_host_name text,
  p_email text,
  p_phone text,
  p_admin_note text,
  p_capacity int,
  p_idempotency_key text,
  p_issued_by uuid
) returns table (invitation_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_label text := regexp_replace(btrim(coalesce(p_table_label, '')), '\s+', ' ', 'g');
  v_name text := regexp_replace(btrim(coalesce(p_host_name, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_existing vip_invitations%rowtype;
  v_bytes bytea;
  v_code text;
  v_id uuid;
begin
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{1,80}$'
     or char_length(v_label) not between 1 and 40
     or char_length(v_name) not between 2 and 80
     or char_length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (v_phone is not null and char_length(v_phone) not between 7 and 40)
     or (v_note is not null and char_length(v_note) > 200)
     or p_capacity is null or p_capacity < 1 or p_capacity > 6
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return query select null::uuid, 'rejected'::text;
    return;
  end if;

  for attempt in 1..8 loop
    select * into v_existing from vip_invitations where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.event_id = p_event_id
         and v_existing.table_label = v_label
         and v_existing.host_name = v_name
         and v_existing.email = v_email
         and v_existing.capacity = p_capacity then
        return query select v_existing.id, 'exists'::text;
      else
        return query select null::uuid, 'idempotency_mismatch'::text;
      end if;
      return;
    end if;

    if exists (
      select 1 from vip_invitations
      where event_id = p_event_id
        and lower(btrim(table_label)) = lower(v_label)
        and status in ('issued', 'partially_admitted', 'fully_admitted')
    ) then
      return query select null::uuid, 'table_taken'::text;
      return;
    end if;

    v_bytes := extensions.gen_random_bytes(6);
    v_code := 'VIP-';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;

    begin
      insert into vip_invitations (
        event_id, table_label, host_name, email, phone, admin_note,
        capacity, code, idempotency_key, issued_by
      ) values (
        p_event_id, v_label, v_name, v_email, v_phone, v_note,
        p_capacity, v_code, p_idempotency_key, p_issued_by
      )
      returning id into v_id;
      return query select v_id, 'created'::text;
      return;
    exception when unique_violation then
      -- A code or token collision retries. A concurrent duplicate key or live
      -- table label is resolved by the checks at the top of the next attempt.
      null;
    end;
  end loop;

  return query select null::uuid, 'rejected'::text;
end;
$$;

-- Atomic partial group admission. The single conditional UPDATE takes the row
-- lock and re-checks admitted + p_count <= capacity against the committed row,
-- so two scanners admitting the last seat cannot both succeed.
create or replace function public.admit_vip_guests(
  p_code text,
  p_event_id text,
  p_count int,
  p_scanned_by text,
  p_device text
) returns table (
  outcome text,
  code text,
  table_label text,
  host_name text,
  capacity int,
  admitted int,
  remaining int,
  status text,
  admitted_now int,
  last_entry_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv vip_invitations%rowtype;
  v_outcome text;
begin
  if p_count is null or p_count < 1 or p_count > 6 or p_scanned_by is null or btrim(p_scanned_by) = '' then
    select * into v_inv from vip_invitations x where x.code = p_code;
    v_outcome := 'invalid-count';
  else
    update vip_invitations x
       set admitted = x.admitted + p_count,
           status = case when x.admitted + p_count = x.capacity then 'fully_admitted' else 'partially_admitted' end,
           last_entry_at = now()
     where x.code = p_code
       and x.event_id = p_event_id
       and x.status in ('issued', 'partially_admitted')
       and x.admitted + p_count <= x.capacity
    returning x.* into v_inv;

    if found then
      insert into vip_admissions (invitation_id, guests, admitted_after, scanned_by, device)
      values (v_inv.id, p_count, v_inv.admitted, left(p_scanned_by, 320), left(p_device, 60));
      return query select 'admitted'::text, v_inv.code, v_inv.table_label, v_inv.host_name, v_inv.capacity,
        v_inv.admitted, v_inv.capacity - v_inv.admitted, v_inv.status, p_count, v_inv.last_entry_at;
      return;
    end if;

    select * into v_inv from vip_invitations x where x.code = p_code;
    v_outcome := case
      when v_inv.id is null then 'not-found'
      when v_inv.event_id <> p_event_id then 'wrong-event'
      when v_inv.status = 'revoked' then 'revoked'
      when v_inv.status = 'cancelled' then 'cancelled'
      when v_inv.admitted >= v_inv.capacity then 'complete'
      else 'exceeds-remaining'
    end;
  end if;

  if v_inv.id is null then
    return query select 'not-found'::text, null::text, null::text, null::text, null::int, null::int, null::int, null::text, 0, null::timestamptz;
    return;
  end if;
  return query select v_outcome, v_inv.code, v_inv.table_label, v_inv.host_name, v_inv.capacity,
    v_inv.admitted, greatest(v_inv.capacity - v_inv.admitted, 0), v_inv.status, 0, v_inv.last_entry_at;
end;
$$;

revoke execute on function public.guard_vip_invitation() from public, anon, authenticated;
revoke execute on function public.reject_vip_admission_change() from public, anon, authenticated;
revoke execute on function public.issue_vip_invitation(text, text, text, text, text, text, int, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.admit_vip_guests(text, text, int, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_vip_invitation(text, text, text, text, text, text, int, text, uuid)
  to service_role;
grant execute on function public.admit_vip_guests(text, text, int, text, text)
  to service_role;
