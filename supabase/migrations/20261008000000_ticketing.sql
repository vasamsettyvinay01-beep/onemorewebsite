-- One More ticketing: orders from Stripe, one ticket (QR) per admitted guest,
-- and an append-only log of every door scan.
--
-- Nothing here is reachable with the anon key: RLS is on with no policies,
-- and every read/write goes through Edge Functions using the service role.

create extension if not exists pgcrypto with schema extensions;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  stripe_payment_intent text unique,
  event_id text not null,
  tier_id text not null,
  tier_name text not null,
  quantity int not null check (quantity > 0),
  purchaser_name text,
  purchaser_email text not null,
  amount_total int not null,
  currency text not null,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'partially-refunded')),
  -- Unguessable key for the buyer's ticket page link.
  access_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id text not null,
  tier_id text not null,
  guest_number int not null,
  -- The only thing a QR code contains.
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  status text not null default 'valid' check (status in ('valid', 'checked-in', 'cancelled')),
  checked_in_at timestamptz,
  checked_in_by text,
  created_at timestamptz not null default now(),
  unique (order_id, guest_number)
);

create table public.scans (
  id bigint generated always as identity primary key,
  ticket_id uuid references public.tickets (id),
  token text not null,
  outcome text not null check (outcome in ('admitted', 'already-used', 'cancelled', 'wrong-event', 'not-found')),
  scanned_by text not null,
  device text,
  created_at timestamptz not null default now()
);

create index tickets_event_status_idx on public.tickets (event_id, status);
create index orders_event_idx on public.orders (event_id);
create index orders_email_idx on public.orders (lower(purchaser_email));
create index scans_created_idx on public.scans (created_at desc);

alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.scans enable row level security;

revoke all on public.orders, public.tickets, public.scans from anon, authenticated;

-- Creates an order and its tickets in one transaction. Safe to call twice for
-- the same Stripe session (webhook retries): the second call returns the
-- existing order and creates nothing.
create or replace function public.create_order_with_tickets(
  p_session_id text,
  p_payment_intent text,
  p_event_id text,
  p_tier_id text,
  p_tier_name text,
  p_quantity int,
  p_admits int,
  p_name text,
  p_email text,
  p_amount_total int,
  p_currency text
) returns table (order_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  insert into orders (stripe_session_id, stripe_payment_intent, event_id, tier_id, tier_name, quantity,
                      purchaser_name, purchaser_email, amount_total, currency)
  values (p_session_id, p_payment_intent, p_event_id, p_tier_id, p_tier_name, p_quantity,
          p_name, p_email, p_amount_total, p_currency)
  on conflict (stripe_session_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select o.id into v_order_id from orders o where o.stripe_session_id = p_session_id;
    return query select v_order_id, false;
    return;
  end if;

  insert into tickets (order_id, event_id, tier_id, guest_number)
  select v_order_id, p_event_id, p_tier_id, g
  from generate_series(1, p_quantity * greatest(p_admits, 1)) as g;

  return query select v_order_id, true;
end;
$$;

-- Atomic door check-in. The conditional UPDATE takes a row lock, so two
-- phones scanning the same code at the same instant can't both admit it.
create or replace function public.check_in_ticket(
  p_token text,
  p_event_id text,
  p_scanned_by text,
  p_device text
) returns table (
  outcome text,
  ticket_id uuid,
  guest_number int,
  guest_count int,
  tier_name text,
  purchaser_name text,
  checked_in_at timestamptz,
  checked_in_by text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
  v_outcome text;
begin
  update tickets t
     set status = 'checked-in', checked_in_at = now(), checked_in_by = p_scanned_by
   where t.token = p_token and t.status = 'valid' and t.event_id = p_event_id
  returning t.* into v_ticket;

  if found then
    v_outcome := 'admitted';
  else
    select * into v_ticket from tickets t where t.token = p_token;
    v_outcome := case
      when v_ticket.id is null then 'not-found'
      when v_ticket.event_id <> p_event_id then 'wrong-event'
      when v_ticket.status = 'cancelled' then 'cancelled'
      else 'already-used'
    end;
  end if;

  insert into scans (ticket_id, token, outcome, scanned_by, device)
  values (v_ticket.id, left(p_token, 128), v_outcome, p_scanned_by, p_device);

  return query
  select v_outcome, v_ticket.id, v_ticket.guest_number,
         (select count(*)::int from tickets x where x.order_id = v_ticket.order_id),
         o.tier_name, o.purchaser_name, v_ticket.checked_in_at, v_ticket.checked_in_by
  from (select 1) s
  left join orders o on o.id = v_ticket.order_id;
end;
$$;

-- Refund in Stripe → cancel the order's tickets that haven't been used yet.
create or replace function public.cancel_order_by_payment_intent(p_payment_intent text, p_full boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_count int := 0;
begin
  update orders set status = case when p_full then 'refunded' else 'partially-refunded' end
   where stripe_payment_intent = p_payment_intent
  returning id into v_order_id;

  if v_order_id is not null and p_full then
    update tickets set status = 'cancelled' where order_id = v_order_id and status = 'valid';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

revoke execute on function public.create_order_with_tickets, public.check_in_ticket,
  public.cancel_order_by_payment_intent from public, anon, authenticated;
