-- Operational controls, per-ticket share links, staff roles, and an append-only audit log.
-- Additive. Does not change prices, paid amounts, QR tokens, inventory, check-in rows, or door access.
-- A missing event_ops row means sales stay open. This migration inserts no rows.
-- Browsers have no policies and no grants. Edge Functions use the service role.
-- Rate-limit storage already exists (api_hits). MFA secrets stay in Supabase Auth, not here.

set lock_timeout = '4s';
set statement_timeout = '60s';

-- Existing ticket rows cascade-delete if an order is deleted. No application path deletes
-- orders, but a cascade would still erase admission history. Restrict it. No row data changes.
alter table public.tickets drop constraint tickets_order_id_fkey;
alter table public.tickets
  add constraint tickets_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete restrict;

create table public.event_ops (
  event_id text primary key check (char_length(event_id) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'paused', 'cancelled')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 500),
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (cancelled_at is null or status = 'cancelled')
);

create table public.ticket_shares (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete restrict,
  token_hash text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ticket_shares_token_hash_key unique (token_hash),
  constraint ticket_shares_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index ticket_shares_ticket_idx on public.ticket_shares (ticket_id);

-- One live link per ticket. Rotating revokes the previous row, then inserts a new one.
create unique index ticket_shares_one_active_idx
  on public.ticket_shares (ticket_id)
  where revoked_at is null;

create table public.staff_roles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  email text not null check (char_length(email) between 3 and 320 and position('@' in email) > 1),
  role text not null check (role in ('super_admin', 'admin', 'door_staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index staff_roles_email_idx on public.staff_roles (lower(email));

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('super_admin', 'admin', 'door_staff')),
  action text not null check (char_length(action) between 1 and 80),
  resource_type text check (resource_type is null or char_length(resource_type) between 1 and 40),
  resource_id text check (resource_id is null or char_length(resource_id) between 1 and 80),
  summary jsonb,
  ip text check (ip is null or char_length(ip) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

alter table public.event_ops enable row level security;
alter table public.ticket_shares enable row level security;
alter table public.staff_roles enable row level security;
alter table public.audit_log enable row level security;

alter table public.event_ops force row level security;
alter table public.ticket_shares force row level security;
alter table public.staff_roles force row level security;
alter table public.audit_log force row level security;

-- No policies: anon and authenticated are denied. service_role bypasses RLS and is server-only.
revoke all on public.event_ops, public.ticket_shares, public.staff_roles, public.audit_log
  from public, anon, authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated, service_role;

revoke insert, update, delete, truncate, references, trigger on public.audit_log from service_role;
grant select on public.audit_log to service_role;

create or replace function public.touch_staff_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger staff_roles_touch
  before update on public.staff_roles
  for each row execute function public.touch_staff_role();

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_audit_mutation();

-- Insert-only helper. Callers cannot update or delete the log, including service_role.
create or replace function public.record_audit(
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_summary jsonb,
  p_ip text,
  p_user_agent text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_summary is not null and jsonb_typeof(p_summary) = 'object' then
    p_summary := p_summary
      - 'password' - 'secret' - 'mfa_secret' - 'otp' - 'card' - 'pan'
      - 'share_token' - 'access_token' - 'token_hash' - 'service_role_key';
  elsif p_summary is not null then
    p_summary := '{}'::jsonb;
  end if;

  insert into audit_log (actor_id, actor_role, action, resource_type, resource_id, summary, ip, user_agent)
  values (
    p_actor_id,
    p_actor_role,
    p_action,
    p_resource_type,
    p_resource_id,
    p_summary,
    left(p_ip, 64),
    left(p_user_agent, 200)
  );
end;
$$;

revoke execute on function public.touch_staff_role() from public, anon, authenticated;
revoke execute on function public.reject_audit_mutation() from public, anon, authenticated;
revoke execute on function public.record_audit(uuid, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.record_audit(uuid, text, text, text, text, jsonb, text, text)
  to service_role;
