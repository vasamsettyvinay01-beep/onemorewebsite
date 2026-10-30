-- Temporary House Party RSVP system. This is deliberately isolated from paid
-- Nov 7 tickets, orders, payments, scanning, and refund logic.

set lock_timeout = '4s';
set statement_timeout = '60s';

create table public.house_party_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,100}$'),
  name text not null check (char_length(name) between 1 and 160),
  event_date date not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  capacity int not null check (capacity > 0 and capacity <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create table public.house_party_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.house_party_events (id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 200),
  email_normalized text not null check (char_length(email_normalized) between 3 and 200),
  phone text not null check (char_length(phone) between 7 and 40),
  phone_normalized text not null check (char_length(phone_normalized) between 10 and 15),
  instagram text,
  party_size int not null check (party_size between 1 and 4),
  guest_names text[] not null default '{}',
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (cardinality(guest_names) = party_size - 1)
);

create index house_party_rsvps_event_status_idx
  on public.house_party_rsvps (event_id, status);
create unique index house_party_rsvps_confirmed_email_idx
  on public.house_party_rsvps (event_id, email_normalized)
  where status = 'confirmed';
create unique index house_party_rsvps_confirmed_phone_idx
  on public.house_party_rsvps (event_id, phone_normalized)
  where status = 'confirmed';

alter table public.house_party_events enable row level security;
alter table public.house_party_rsvps enable row level security;
revoke all on public.house_party_events, public.house_party_rsvps from public, anon, authenticated;

insert into public.house_party_events (slug, name, event_date, starts_at, expires_at, capacity, active)
values (
  'diwali-halloween-house-party-2026',
  'Diwali × Halloween House Party',
  date '2026-10-30',
  timestamptz '2026-10-31 02:00:00+00',
  timestamptz '2026-10-31 05:00:00+00',
  30,
  true
)
on conflict (slug) do nothing;

-- Every confirmation takes the event-row lock before totals are read. This
-- serializes competing reservations for this one event, so confirmed attendees
-- cannot exceed capacity even with simultaneous submissions.
create or replace function public.create_house_party_rsvp(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_instagram text,
  p_party_size int,
  p_guest_names text[]
) returns table (
  outcome text,
  rsvp_id uuid,
  confirmed_party_size int,
  remaining_capacity int,
  existing_party_size int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event house_party_events%rowtype;
  v_full_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := trim(coalesce(p_phone, ''));
  v_phone_normalized text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_instagram text := nullif(trim(coalesce(p_instagram, '')), '');
  v_guest_names text[] := coalesce(p_guest_names, '{}'::text[]);
  v_confirmed int;
  v_existing int;
  v_rsvp house_party_rsvps%rowtype;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,100}$' then
    return query select 'invalid'::text, null::uuid, null::int, null::int, null::int;
    return;
  end if;
  if p_party_size is null or p_party_size < 1 or p_party_size > 4
     or char_length(v_full_name) < 2 or char_length(v_full_name) > 120
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(v_email) > 200
     or char_length(v_phone) < 7 or char_length(v_phone) > 40
     or char_length(v_phone_normalized) < 10 or char_length(v_phone_normalized) > 15
     or (v_instagram is not null and char_length(v_instagram) > 100)
     or cardinality(v_guest_names) <> p_party_size - 1
     or exists (
       select 1
       from unnest(v_guest_names) as guest_name
       where char_length(regexp_replace(trim(guest_name), '\s+', ' ', 'g')) < 2
          or char_length(regexp_replace(trim(guest_name), '\s+', ' ', 'g')) > 120
     ) then
    return query select 'invalid'::text, null::uuid, null::int, null::int, null::int;
    return;
  end if;

  select * into v_event
  from house_party_events
  where slug = p_slug
  for update;

  if not found or not v_event.active then
    return query select 'ended'::text, null::uuid, null::int, 0, null::int;
    return;
  end if;
  if now() >= v_event.expires_at then
    return query select 'ended'::text, null::uuid, null::int, 0, null::int;
    return;
  end if;

  select party_size into v_existing
  from house_party_rsvps
  where event_id = v_event.id
    and status = 'confirmed'
    and (email_normalized = v_email or phone_normalized = v_phone_normalized)
  limit 1;
  if found then
    select coalesce(sum(party_size), 0)::int into v_confirmed
    from house_party_rsvps
    where event_id = v_event.id and status = 'confirmed';
    return query select 'duplicate'::text, null::uuid, null::int,
      greatest(v_event.capacity - v_confirmed, 0), v_existing;
    return;
  end if;

  select coalesce(sum(party_size), 0)::int into v_confirmed
  from house_party_rsvps
  where event_id = v_event.id and status = 'confirmed';

  if v_confirmed + p_party_size > v_event.capacity then
    return query select
      case when v_confirmed >= v_event.capacity then 'full' else 'insufficient_capacity' end,
      null::uuid,
      null::int,
      greatest(v_event.capacity - v_confirmed, 0),
      null::int;
    return;
  end if;

  begin
    insert into house_party_rsvps (
      event_id, full_name, email, email_normalized, phone, phone_normalized,
      instagram, party_size, guest_names
    ) values (
      v_event.id, v_full_name, v_email, v_email, v_phone, v_phone_normalized,
      v_instagram, p_party_size,
      array(
        select regexp_replace(trim(guest_name), '\s+', ' ', 'g')
        from unnest(v_guest_names) as guest_name
      )
    )
    returning * into v_rsvp;
  exception when unique_violation then
    select party_size into v_existing
    from house_party_rsvps
    where event_id = v_event.id
      and status = 'confirmed'
      and (email_normalized = v_email or phone_normalized = v_phone_normalized)
    limit 1;
    select coalesce(sum(party_size), 0)::int into v_confirmed
    from house_party_rsvps
    where event_id = v_event.id and status = 'confirmed';
    return query select 'duplicate'::text, null::uuid, null::int,
      greatest(v_event.capacity - v_confirmed, 0), v_existing;
    return;
  end;

  return query select 'confirmed'::text, v_rsvp.id, v_rsvp.party_size,
    greatest(v_event.capacity - (v_confirmed + v_rsvp.party_size), 0), null::int;
end;
$$;

create or replace function public.house_party_status(p_slug text)
returns table (
  state text,
  capacity int,
  confirmed_people int,
  rsvp_groups int,
  spots_remaining int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event house_party_events%rowtype;
  v_people int;
  v_groups int;
begin
  select * into v_event
  from house_party_events
  where slug = p_slug;

  if not found or not v_event.active or now() >= v_event.expires_at then
    return query select 'ended'::text, 0, 0, 0, 0;
    return;
  end if;

  select coalesce(sum(party_size), 0)::int, count(*)::int
    into v_people, v_groups
  from house_party_rsvps
  where event_id = v_event.id and status = 'confirmed';

  return query select
    case when v_people >= v_event.capacity then 'full' else 'active' end,
    v_event.capacity,
    v_people,
    v_groups,
    greatest(v_event.capacity - v_people, 0);
end;
$$;

revoke execute on function public.create_house_party_rsvp(text, text, text, text, text, int, text[]) from public, anon, authenticated;
revoke execute on function public.house_party_status(text) from public, anon, authenticated;
grant execute on function public.create_house_party_rsvp(text, text, text, text, text, int, text[]) to service_role;
grant execute on function public.house_party_status(text) to service_role;
