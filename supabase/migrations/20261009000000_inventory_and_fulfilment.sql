-- Launch guards: checkout holds, atomic capacity, webhook idempotency,
-- and refund/dispute flags that survive an out-of-order webhook.
-- Additive only. Does not delete or rewrite existing orders or tickets.

create table public.checkout_holds (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  payment_intent_id text unique,
  event_id text not null,
  tier_id text not null,
  quantity int not null check (quantity > 0 and quantity <= 20),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index checkout_holds_tier_idx on public.checkout_holds (event_id, tier_id, expires_at);

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table public.payment_flags (
  payment_intent text primary key,
  full_refund boolean not null default false,
  partial_refund boolean not null default false,
  disputed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.api_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index api_hits_bucket_idx on public.api_hits (bucket, created_at);

alter table public.checkout_holds enable row level security;
alter table public.stripe_events enable row level security;
alter table public.payment_flags enable row level security;
alter table public.api_hits enable row level security;

revoke all on public.checkout_holds, public.stripe_events, public.payment_flags, public.api_hits from anon, authenticated;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('paid', 'refunded', 'partially-refunded', 'disputed'));

create or replace function public.tier_sold(p_event_id text, p_tier_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::int
  from orders
  where event_id = p_event_id
    and tier_id = p_tier_id
    and status <> 'refunded';
$$;

create or replace function public.tier_held(p_event_id text, p_tier_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::int
  from checkout_holds
  where event_id = p_event_id
    and tier_id = p_tier_id
    and expires_at > now();
$$;

create or replace function public.event_sales(p_event_id text)
returns table (tier_id text, quantity int)
language sql
stable
security definer
set search_path = public
as $$
  select o.tier_id, coalesce(sum(o.quantity), 0)::int
  from orders o
  where o.event_id = p_event_id
    and o.status <> 'refunded'
  group by o.tier_id;
$$;

create or replace function public.event_holds(p_event_id text)
returns table (tier_id text, quantity int)
language sql
stable
security definer
set search_path = public
as $$
  select h.tier_id, coalesce(sum(h.quantity), 0)::int
  from checkout_holds h
  where h.event_id = p_event_id
    and h.expires_at > now()
  group by h.tier_id;
$$;

-- Serialises on the tier row. The same idempotency key returns the existing hold.
create or replace function public.reserve_passes(
  p_event_id text,
  p_tier_id text,
  p_quantity int,
  p_idempotency_key text
) returns table (hold_id uuid, payment_intent_id text, already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier tiers%rowtype;
  v_hold checkout_holds%rowtype;
  v_sold int;
  v_held int;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 80 then
    raise exception 'bad_idempotency';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'bad_quantity';
  end if;

  select * into v_tier
  from tiers
  where event_id = p_event_id and tier_id = p_tier_id and active
  for update;
  if not found then
    raise exception 'unavailable';
  end if;
  if p_quantity > v_tier.max_per_order then
    raise exception 'too_many';
  end if;

  select * into v_hold from checkout_holds where idempotency_key = p_idempotency_key for update;
  if found then
    if v_hold.event_id <> p_event_id or v_hold.tier_id <> p_tier_id or v_hold.quantity <> p_quantity then
      raise exception 'idempotency_mismatch';
    end if;
    if v_hold.expires_at > now() or v_hold.payment_intent_id is not null then
      return query select v_hold.id, v_hold.payment_intent_id, true;
      return;
    end if;
    delete from checkout_holds where id = v_hold.id;
  end if;

  if v_tier.capacity is not null then
    v_sold := public.tier_sold(p_event_id, p_tier_id);
    v_held := public.tier_held(p_event_id, p_tier_id);
    if v_sold + v_held + p_quantity > v_tier.capacity then
      raise exception 'sold_out';
    end if;
  end if;

  insert into checkout_holds (idempotency_key, event_id, tier_id, quantity, expires_at)
  values (p_idempotency_key, p_event_id, p_tier_id, p_quantity, now() + interval '20 minutes')
  returning * into v_hold;

  return query select v_hold.id, v_hold.payment_intent_id, false;
end;
$$;

drop function if exists public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text);

-- Idempotent on either the Stripe session id or the payment intent.
-- Admits, price and name come from the tiers row, not from the caller.
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
) returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier tiers%rowtype;
  v_order_id uuid;
  v_flags payment_flags%rowtype;
  v_status text;
  v_ticket_status text;
  v_sold int;
  v_admits int;
begin
  if p_session_id is null or p_payment_intent is null or p_email is null or length(trim(p_email)) < 3 then
    return query select null::uuid, 'rejected';
    return;
  end if;

  select o.id into v_order_id from orders o
   where o.stripe_payment_intent = p_payment_intent
      or o.stripe_session_id = p_session_id
   limit 1;
  if v_order_id is not null then
    return query select v_order_id, 'exists';
    return;
  end if;

  select * into v_tier from tiers
   where event_id = p_event_id and tier_id = p_tier_id
   for update;
  if not found then
    return query select null::uuid, 'rejected';
    return;
  end if;

  -- A concurrent fulfilment of the same payment may have inserted while we waited for the lock.
  select o.id into v_order_id from orders o
   where o.stripe_payment_intent = p_payment_intent
      or o.stripe_session_id = p_session_id
   limit 1;
  if v_order_id is not null then
    return query select v_order_id, 'exists';
    return;
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > least(v_tier.max_per_order, 20) then
    return query select null::uuid, 'rejected';
    return;
  end if;
  if lower(coalesce(p_currency, '')) is distinct from lower(v_tier.currency)
     or p_amount_total is null
     or p_amount_total < v_tier.price_cents * p_quantity then
    delete from checkout_holds where payment_intent_id = p_payment_intent;
    return query select null::uuid, 'underpaid';
    return;
  end if;

  select * into v_flags from payment_flags where payment_intent = p_payment_intent;
  if not found then
    v_status := 'paid';
  elsif v_flags.disputed then
    v_status := 'disputed';
  elsif v_flags.full_refund then
    v_status := 'refunded';
  elsif v_flags.partial_refund then
    v_status := 'partially-refunded';
  else
    v_status := 'paid';
  end if;

  if v_tier.capacity is not null and v_status in ('paid', 'partially-refunded', 'disputed') then
    v_sold := public.tier_sold(p_event_id, p_tier_id);
    if v_sold + p_quantity > v_tier.capacity then
      delete from checkout_holds where payment_intent_id = p_payment_intent;
      return query select null::uuid, 'oversold';
      return;
    end if;
  end if;

  v_admits := greatest(v_tier.admits, 1);
  v_ticket_status := case when v_status in ('refunded', 'disputed') then 'cancelled' else 'valid' end;

  insert into orders (
    stripe_session_id, stripe_payment_intent, event_id, tier_id, tier_name, quantity,
    purchaser_name, purchaser_email, amount_total, currency, status
  ) values (
    p_session_id, p_payment_intent, p_event_id, p_tier_id, v_tier.name, p_quantity,
    nullif(trim(p_name), ''), trim(p_email), p_amount_total, lower(p_currency), v_status
  )
  returning id into v_order_id;

  insert into tickets (order_id, event_id, tier_id, guest_number, status)
  select v_order_id, p_event_id, p_tier_id, g, v_ticket_status
  from generate_series(1, p_quantity * v_admits) as g;

  delete from checkout_holds where payment_intent_id = p_payment_intent;
  return query select v_order_id, 'created';
exception
  when unique_violation then
    select o.id into v_order_id from orders o
     where o.stripe_payment_intent = p_payment_intent
        or o.stripe_session_id = p_session_id
     limit 1;
    return query select v_order_id, 'exists';
end;
$$;

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
  insert into payment_flags (payment_intent, full_refund, partial_refund)
  values (p_payment_intent, p_full, not p_full)
  on conflict (payment_intent) do update
    set full_refund = payment_flags.full_refund or excluded.full_refund,
        partial_refund = payment_flags.partial_refund or excluded.partial_refund,
        updated_at = now();

  update orders
     set status = case when p_full then 'refunded' else 'partially-refunded' end
   where stripe_payment_intent = p_payment_intent
  returning id into v_order_id;

  if v_order_id is not null and p_full then
    update tickets set status = 'cancelled' where order_id = v_order_id and status = 'valid';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

create or replace function public.mark_payment_disputed(p_payment_intent text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_count int := 0;
begin
  insert into payment_flags (payment_intent, disputed)
  values (p_payment_intent, true)
  on conflict (payment_intent) do update
    set disputed = true, updated_at = now();

  update orders set status = 'disputed'
   where stripe_payment_intent = p_payment_intent
  returning id into v_order_id;

  if v_order_id is not null then
    update tickets set status = 'cancelled' where order_id = v_order_id and status = 'valid';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

create or replace function public.allow_request(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_bucket is null or length(p_bucket) < 3 or length(p_bucket) > 120 or p_limit < 1 then
    return false;
  end if;
  delete from api_hits
   where bucket = p_bucket
     and created_at < now() - make_interval(secs => greatest(p_window_seconds, 1));
  select count(*) into v_count from api_hits where bucket = p_bucket;
  if v_count >= p_limit then
    return false;
  end if;
  insert into api_hits (bucket) values (p_bucket);
  return true;
end;
$$;

revoke execute on function
  public.tier_sold(text, text),
  public.tier_held(text, text),
  public.event_sales(text),
  public.event_holds(text),
  public.reserve_passes(text, text, int, text),
  public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text),
  public.cancel_order_by_payment_intent(text, boolean),
  public.mark_payment_disputed(text),
  public.allow_request(text, int, int)
from public, anon, authenticated;

grant execute on function
  public.tier_sold(text, text),
  public.tier_held(text, text),
  public.event_sales(text),
  public.event_holds(text),
  public.reserve_passes(text, text, int, text),
  public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text),
  public.cancel_order_by_payment_intent(text, boolean),
  public.mark_payment_disputed(text),
  public.allow_request(text, int, int)
to service_role;
