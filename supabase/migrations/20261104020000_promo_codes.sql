-- Promo codes for paid checkout, with a permanent price snapshot on each order.
-- Additive. No existing order, ticket, payment, or scan row is changed.

set lock_timeout = '4s';
set statement_timeout = '60s';

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9]{3,32}$'),
  event_id text not null,
  discount_type text not null check (discount_type in ('percentage')),
  discount_value int not null check (discount_value between 1 and 100),
  active boolean not null default true,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, code),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);

alter table public.promotions enable row level security;
revoke all on public.promotions from anon, authenticated;

insert into public.promotions (code, event_id, discount_type, discount_value)
select 'GISO15', 'evt_diwali_night', 'percentage', 15
where exists (select 1 from public.tiers where event_id = 'evt_diwali_night')
on conflict (event_id, code) do nothing;

alter table public.orders
  add column promotion_id uuid references public.promotions (id) on delete restrict,
  add column promo_code text,
  add column discount_percent int,
  add column original_subtotal_cents int,
  add column discount_amount_cents int,
  add column discounted_subtotal_cents int,
  add column tax_cents int,
  add column final_total_cents int,
  add constraint orders_pricing_snapshot_check check (
    original_subtotal_cents is null
    or (
      original_subtotal_cents >= 0
      and discount_amount_cents between 0 and original_subtotal_cents
      and discounted_subtotal_cents = original_subtotal_cents - discount_amount_cents
      and tax_cents >= 0
      and final_total_cents = discounted_subtotal_cents + tax_cents
      and final_total_cents = amount_total
    )
  ),
  add constraint orders_promo_snapshot_check check (
    (promo_code is null and promotion_id is null and discount_percent is null)
    or (
      promo_code is not null
      and promotion_id is not null
      and discount_percent between 1 and 100
      and original_subtotal_cents is not null
    )
  );

create index orders_promo_idx on public.orders (event_id, promo_code, created_at desc) where promo_code is not null;

-- Attribution and the price snapshot are written once, at fulfilment. Refunds,
-- disputes and email bookkeeping only touch status and emailed_at.
create or replace function public.lock_order_pricing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.promotion_id is distinct from new.promotion_id
     or old.promo_code is distinct from new.promo_code
     or old.discount_percent is distinct from new.discount_percent
     or old.original_subtotal_cents is distinct from new.original_subtotal_cents
     or old.discount_amount_cents is distinct from new.discount_amount_cents
     or old.discounted_subtotal_cents is distinct from new.discounted_subtotal_cents
     or old.tax_cents is distinct from new.tax_cents
     or old.final_total_cents is distinct from new.final_total_cents
     or old.amount_total is distinct from new.amount_total then
    raise exception 'order_pricing_immutable';
  end if;
  return new;
end;
$$;

create trigger orders_lock_pricing
before update on public.orders
for each row execute function public.lock_order_pricing();

drop function if exists public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text);

-- Idempotent on either the Stripe session id or the payment intent. Price,
-- admits and the discount are recomputed here from the tier and promotion rows.
-- The new promo arguments default to null so a caller without a promo is unchanged.
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
  p_currency text,
  p_promotion_id uuid default null,
  p_promo_code text default null,
  p_discount_percent int default null
) returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier tiers%rowtype;
  v_promo promotions%rowtype;
  v_order_id uuid;
  v_flags payment_flags%rowtype;
  v_status text;
  v_ticket_status text;
  v_sold int;
  v_admits int;
  v_subtotal int;
  v_discount int := 0;
  v_discounted int;
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

  v_subtotal := v_tier.price_cents * p_quantity;

  if p_promo_code is not null or p_promotion_id is not null or p_discount_percent is not null then
    select * into v_promo from promotions
     where id = p_promotion_id
       and code = p_promo_code
       and event_id = p_event_id
       and discount_type = 'percentage';
    -- The percent is the snapshot quoted at checkout. A later change to the
    -- promotion must not reprice or reject a payment that already succeeded.
    if not found or p_discount_percent is null or p_discount_percent < 1 or p_discount_percent > 100 then
      delete from checkout_holds where payment_intent_id = p_payment_intent;
      return query select null::uuid, 'rejected';
      return;
    end if;
    v_discount := (v_subtotal * p_discount_percent + 50) / 100;
  end if;
  v_discounted := v_subtotal - v_discount;

  if lower(coalesce(p_currency, '')) is distinct from lower(v_tier.currency)
     or p_amount_total is null
     or p_amount_total < v_discounted then
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
    purchaser_name, purchaser_email, amount_total, currency, status,
    promotion_id, promo_code, discount_percent,
    original_subtotal_cents, discount_amount_cents, discounted_subtotal_cents, tax_cents, final_total_cents
  ) values (
    p_session_id, p_payment_intent, p_event_id, p_tier_id, v_tier.name, p_quantity,
    nullif(trim(p_name), ''), trim(p_email), p_amount_total, lower(p_currency), v_status,
    v_promo.id, v_promo.code, case when v_promo.id is null then null else p_discount_percent end,
    v_subtotal, v_discount, v_discounted, p_amount_total - v_discounted, p_amount_total
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

revoke execute on function
  public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text, uuid, text, int),
  public.lock_order_pricing()
from public, anon, authenticated;

grant execute on function
  public.create_order_with_tickets(text, text, text, text, text, int, int, text, text, int, text, uuid, text, int)
to service_role;
