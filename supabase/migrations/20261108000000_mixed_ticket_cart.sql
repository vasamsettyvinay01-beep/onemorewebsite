-- Mixed-ticket carts: several ticket types in one payment, one order.
--
-- ADDITIVE. No existing order, ticket, scan, payment or promotion row is read
-- or written. Existing single-ticket orders keep their shape and keep working:
-- an order WITHOUT order_items is counted and displayed exactly as before.
-- An order WITH order_items is counted line by line.
--
--   checkout_carts       frozen server-side cart snapshot a PaymentIntent points at
--   checkout_hold_items  the lines of a cart hold (the hold row itself stays one row)
--   order_items          immutable per-line snapshot of what an order bought
--
-- Rollback: nothing existing depends on the new objects. Dropping them and
-- re-creating the four inventory functions from 20261019000000 / 20261009000000
-- restores the previous behaviour.

set lock_timeout = '4s';
set statement_timeout = '60s';

-- ── Frozen cart snapshots ────────────────────────────────────────────────────

create table public.checkout_carts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_id text not null,
  payment_intent_id text unique,
  currency text not null,
  total_cents int not null check (total_cents > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.checkout_carts enable row level security;
revoke all on public.checkout_carts from anon, authenticated;

-- A cart is written once. Only the PaymentIntent link may be attached, once.
create or replace function public.lock_checkout_cart()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.idempotency_key is distinct from new.idempotency_key
     or old.event_id is distinct from new.event_id
     or old.currency is distinct from new.currency
     or old.total_cents is distinct from new.total_cents
     or old.snapshot is distinct from new.snapshot
     or old.created_at is distinct from new.created_at
     or (old.payment_intent_id is not null and old.payment_intent_id is distinct from new.payment_intent_id) then
    raise exception 'checkout_cart_immutable';
  end if;
  return new;
end;
$$;

create trigger checkout_carts_lock
before update on public.checkout_carts
for each row execute function public.lock_checkout_cart();

-- ── Cart holds ───────────────────────────────────────────────────────────────

alter table public.checkout_holds
  alter column tier_id drop not null,
  alter column quantity drop not null,
  add column cart_id uuid references public.checkout_carts (id),
  add constraint checkout_holds_shape_check check (
    (cart_id is null and tier_id is not null and quantity is not null)
    or (cart_id is not null and tier_id is null and quantity is null)
  );

create table public.checkout_hold_items (
  hold_id uuid not null references public.checkout_holds (id) on delete cascade,
  event_id text not null,
  tier_id text not null,
  quantity int not null check (quantity > 0 and quantity <= 20),
  primary key (hold_id, tier_id)
);

create index checkout_hold_items_tier_idx on public.checkout_hold_items (event_id, tier_id);

alter table public.checkout_hold_items enable row level security;
revoke all on public.checkout_hold_items from anon, authenticated;

-- ── Order items ──────────────────────────────────────────────────────────────

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id text not null,
  position int not null check (position >= 1),
  tier_id text not null,
  display_name_snapshot text not null,
  unit_price_cents int not null check (unit_price_cents >= 0),
  quantity int not null check (quantity > 0),
  admissions_per_unit int not null check (admissions_per_unit > 0),
  total_admissions int not null,
  original_line_subtotal_cents int not null,
  promo_eligible boolean not null default false,
  eligible_discount_cents int not null default 0,
  discounted_line_subtotal_cents int not null,
  -- Order tax apportioned across lines by discounted value. Reporting only.
  tax_cents int not null default 0 check (tax_cents >= 0),
  line_total_cents int not null,
  created_at timestamptz not null default now(),
  unique (order_id, tier_id),
  unique (order_id, position),
  constraint order_items_admissions_check check (total_admissions = quantity * admissions_per_unit),
  constraint order_items_original_check check (original_line_subtotal_cents = unit_price_cents * quantity),
  constraint order_items_discount_check check (
    eligible_discount_cents between 0 and original_line_subtotal_cents
    and (promo_eligible or eligible_discount_cents = 0)
    and discounted_line_subtotal_cents = original_line_subtotal_cents - eligible_discount_cents
  ),
  constraint order_items_total_check check (line_total_cents = discounted_line_subtotal_cents + tax_cents)
);

create index order_items_event_tier_idx on public.order_items (event_id, tier_id);
create index order_items_order_idx on public.order_items (order_id);

alter table public.order_items enable row level security;
revoke all on public.order_items from anon, authenticated;

create or replace function public.lock_order_items()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'order_items_immutable';
end;
$$;

create trigger order_items_lock
before update on public.order_items
for each row execute function public.lock_order_items();

-- ── Inventory ────────────────────────────────────────────────────────────────
-- One rule: an order that has order_items is counted by its items; any other
-- order is counted by its own tier_id and quantity, exactly as before.
-- Refunded orders drop out either way, so a full refund restores every line.

create or replace function public.tier_sold(p_event_id text, p_tier_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((
      select sum(o.quantity)
      from orders o
      where o.event_id = p_event_id
        and o.tier_id = p_tier_id
        and o.status <> 'refunded'
        and not o.is_complimentary
        and not exists (select 1 from order_items i where i.order_id = o.id)
    ), 0)
    + coalesce((
      select sum(i.quantity)
      from order_items i
      join orders o on o.id = i.order_id
      where i.event_id = p_event_id
        and i.tier_id = p_tier_id
        and o.status <> 'refunded'
        and not o.is_complimentary
    ), 0)
  )::int;
$$;

create or replace function public.event_sales(p_event_id text)
returns table (tier_id text, quantity int)
language sql
stable
security definer
set search_path = public
as $$
  select s.tier_id, sum(s.quantity)::int
  from (
    select o.tier_id, o.quantity
    from orders o
    where o.event_id = p_event_id
      and o.status <> 'refunded'
      and not o.is_complimentary
      and not exists (select 1 from order_items i where i.order_id = o.id)
    union all
    select i.tier_id, i.quantity
    from order_items i
    join orders o on o.id = i.order_id
    where i.event_id = p_event_id
      and o.status <> 'refunded'
      and not o.is_complimentary
  ) s
  group by s.tier_id;
$$;

create or replace function public.tier_held(p_event_id text, p_tier_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((
      select sum(h.quantity)
      from checkout_holds h
      where h.event_id = p_event_id
        and h.tier_id = p_tier_id
        and h.expires_at > now()
    ), 0)
    + coalesce((
      select sum(hi.quantity)
      from checkout_hold_items hi
      join checkout_holds h on h.id = hi.hold_id
      where hi.event_id = p_event_id
        and hi.tier_id = p_tier_id
        and h.expires_at > now()
    ), 0)
  )::int;
$$;

create or replace function public.event_holds(p_event_id text)
returns table (tier_id text, quantity int)
language sql
stable
security definer
set search_path = public
as $$
  select s.tier_id, sum(s.quantity)::int
  from (
    select h.tier_id, h.quantity
    from checkout_holds h
    where h.event_id = p_event_id
      and h.tier_id is not null
      and h.expires_at > now()
    union all
    select hi.tier_id, hi.quantity
    from checkout_hold_items hi
    join checkout_holds h on h.id = hi.hold_id
    where hi.event_id = p_event_id
      and h.expires_at > now()
  ) s
  group by s.tier_id;
$$;

-- ── Atomic cart hold ─────────────────────────────────────────────────────────
-- Locks every ticket type in the cart (sorted, so two carts never deadlock),
-- checks every line, then writes the hold. Any failing line raises, and the
-- whole transaction rolls back: no line is ever held on its own.
-- The same idempotency key returns the existing hold.

create or replace function public.reserve_cart(
  p_event_id text,
  p_items jsonb,
  p_idempotency_key text,
  p_snapshot jsonb,
  p_currency text,
  p_total_cents int
) returns table (hold_id uuid, cart_id uuid, payment_intent_id text, already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_tier tiers%rowtype;
  v_hold checkout_holds%rowtype;
  v_cart_id uuid;
  v_count int;
  v_admissions int := 0;
  v_sold int;
  v_held int;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 80 then
    raise exception 'bad_idempotency';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 8 then
    raise exception 'bad_cart';
  end if;
  if p_snapshot is null or p_total_cents is null or p_total_cents < 1 or p_currency is null then
    raise exception 'bad_cart';
  end if;

  v_count := jsonb_array_length(p_items);
  if (select count(distinct e->>'tier_id') from jsonb_array_elements(p_items) e) <> v_count then
    raise exception 'duplicate_item';
  end if;

  -- Lock and validate every ticket type, in a fixed order.
  for v_item in
    select e->>'tier_id' as tier_id, (e->>'quantity')::int as quantity
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 20 then
      raise exception 'bad_quantity';
    end if;
    select * into v_tier
    from tiers
    where event_id = p_event_id and tier_id = v_item.tier_id and active
    for update;
    if not found then
      raise exception 'unavailable:%', v_item.tier_id;
    end if;
    if v_item.quantity > v_tier.max_per_order then
      raise exception 'too_many:%', v_item.tier_id;
    end if;
    v_admissions := v_admissions + v_item.quantity * greatest(v_tier.admits, 1);
  end loop;
  if v_admissions > 20 then
    raise exception 'too_many_admissions';
  end if;

  select * into v_hold from checkout_holds where idempotency_key = p_idempotency_key for update;
  if found then
    if v_hold.cart_id is null or v_hold.event_id <> p_event_id
       or (select count(*) from checkout_hold_items hi where hi.hold_id = v_hold.id) <> v_count
       or exists (
         select 1 from jsonb_array_elements(p_items) l
         where not exists (
           select 1 from checkout_hold_items hi
           where hi.hold_id = v_hold.id and hi.tier_id = l->>'tier_id' and hi.quantity = (l->>'quantity')::int
         )
       ) then
      raise exception 'idempotency_mismatch';
    end if;
    if v_hold.expires_at > now() or v_hold.payment_intent_id is not null then
      return query select v_hold.id, v_hold.cart_id, v_hold.payment_intent_id, true;
      return;
    end if;
    delete from checkout_holds where id = v_hold.id;
  end if;

  -- A cart that never reached a PaymentIntent and has no hold is dead weight that would block the key.
  delete from checkout_carts c
   where c.idempotency_key = p_idempotency_key
     and c.payment_intent_id is null
     and not exists (select 1 from checkout_holds h where h.cart_id = c.id);

  -- Capacity: every capped line must fit, counting paid orders and live holds.
  for v_item in
    select e->>'tier_id' as tier_id, (e->>'quantity')::int as quantity
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    select * into v_tier from tiers where event_id = p_event_id and tier_id = v_item.tier_id;
    if v_tier.capacity is not null then
      v_sold := public.tier_sold(p_event_id, v_item.tier_id);
      v_held := public.tier_held(p_event_id, v_item.tier_id);
      if v_sold + v_held + v_item.quantity > v_tier.capacity then
        raise exception 'sold_out:%', v_item.tier_id;
      end if;
    end if;
  end loop;

  insert into checkout_carts (idempotency_key, event_id, currency, total_cents, snapshot)
  values (p_idempotency_key, p_event_id, lower(p_currency), p_total_cents, p_snapshot)
  returning id into v_cart_id;

  insert into checkout_holds (idempotency_key, event_id, cart_id, expires_at)
  values (p_idempotency_key, p_event_id, v_cart_id, now() + interval '20 minutes')
  returning * into v_hold;

  insert into checkout_hold_items (hold_id, event_id, tier_id, quantity)
  select v_hold.id, p_event_id, l->>'tier_id', (l->>'quantity')::int from jsonb_array_elements(p_items) l;

  return query select v_hold.id, v_cart_id, v_hold.payment_intent_id, false;
end;
$$;

-- ── Atomic cart fulfilment ───────────────────────────────────────────────────
-- Reads the frozen cart snapshot (never the caller's numbers), re-derives each
-- line and the discount, then writes the order, its items and every pass in one
-- transaction. Idempotent on the payment intent or session id.

create or replace function public.create_cart_order(
  p_session_id text,
  p_payment_intent text,
  p_cart_id uuid,
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
  v_cart checkout_carts%rowtype;
  v_snap jsonb;
  v_line record;
  v_tier tiers%rowtype;
  v_promo promotions%rowtype;
  v_percent int;
  v_order_id uuid;
  v_flags payment_flags%rowtype;
  v_status text;
  v_ticket_status text;
  v_lines int;
  v_units int := 0;
  v_admissions int := 0;
  v_original int := 0;
  v_discount int := 0;
  v_discounted int := 0;
  v_tax_sum int := 0;
  v_expected_discount int;
  v_tier_id text;
  v_tier_name text;
begin
  if p_session_id is null or p_payment_intent is null or p_cart_id is null
     or p_email is null or length(trim(p_email)) < 3 then
    return query select null::uuid, 'rejected';
    return;
  end if;

  select o.id into v_order_id from orders o
   where o.stripe_payment_intent = p_payment_intent or o.stripe_session_id = p_session_id
   limit 1;
  if v_order_id is not null then
    return query select v_order_id, 'exists';
    return;
  end if;

  select * into v_cart from checkout_carts where id = p_cart_id;
  if not found
     or (v_cart.payment_intent_id is not null and v_cart.payment_intent_id <> p_payment_intent) then
    return query select null::uuid, 'rejected';
    return;
  end if;
  v_snap := v_cart.snapshot;
  v_lines := jsonb_array_length(v_snap->'lines');
  if v_lines is null or v_lines < 1 or v_lines > 8 then
    delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
    return query select null::uuid, 'rejected';
    return;
  end if;

  -- Lock every ticket type in the cart, in a fixed order, as reservation does.
  for v_line in
    select l->>'tierId' as tier_id
    from jsonb_array_elements(v_snap->'lines') l
    order by 1
  loop
    select * into v_tier from tiers where event_id = v_cart.event_id and tier_id = v_line.tier_id for update;
    if not found then
      delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
      return query select null::uuid, 'rejected';
      return;
    end if;
  end loop;

  -- A concurrent fulfilment of the same payment may have inserted while we waited for the locks.
  select o.id into v_order_id from orders o
   where o.stripe_payment_intent = p_payment_intent or o.stripe_session_id = p_session_id
   limit 1;
  if v_order_id is not null then
    return query select v_order_id, 'exists';
    return;
  end if;

  -- Promotion: same checks as the single-ticket path, then each eligible line is re-derived below.
  if v_snap->'promo' is not null and jsonb_typeof(v_snap->'promo') = 'object' then
    v_percent := (v_snap->'promo'->>'percent')::int;
    select * into v_promo from promotions
     where id = (v_snap->'promo'->>'id')::uuid
       and code = v_snap->'promo'->>'code'
       and event_id = v_cart.event_id
       and discount_type = 'percentage';
    if not found or v_percent is null or v_percent < 1 or v_percent > 100 then
      delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
      return query select null::uuid, 'rejected';
      return;
    end if;
  end if;

  -- Every line must agree with itself, with the promo, and with the totals.
  for v_line in
    select (l->>'position')::int as position, l->>'tierId' as tier_id, l->>'name' as name,
           (l->>'unitCents')::int as unit, (l->>'quantity')::int as qty,
           (l->>'admissionsPerUnit')::int as admits,
           (l->>'originalLineCents')::int as original, (l->>'promoEligible')::boolean as eligible,
           (l->>'discountCents')::int as discount, (l->>'discountedLineCents')::int as discounted,
           (l->>'taxCents')::int as tax
    from jsonb_array_elements(v_snap->'lines') l
  loop
    if v_line.qty is null or v_line.qty < 1 or v_line.qty > 20
       or v_line.unit is null or v_line.unit < 0
       or v_line.admits is null or v_line.admits < 1
       or v_line.original <> v_line.unit * v_line.qty then
      delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
      return query select null::uuid, 'rejected';
      return;
    end if;
    if coalesce(v_line.eligible, false) and v_promo.id is not null then
      v_expected_discount := (v_line.original * v_percent + 50) / 100;
    else
      v_expected_discount := 0;
    end if;
    if v_line.discount <> v_expected_discount
       or v_line.discounted <> v_line.original - v_line.discount
       or (coalesce(v_line.eligible, false) and v_promo.id is null) then
      delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
      return query select null::uuid, 'rejected';
      return;
    end if;
    v_units := v_units + v_line.qty;
    v_admissions := v_admissions + v_line.qty * v_line.admits;
    v_original := v_original + v_line.original;
    v_discount := v_discount + v_line.discount;
    v_discounted := v_discounted + v_line.discounted;
    v_tax_sum := v_tax_sum + v_line.tax;
  end loop;

  if v_admissions > 20 then
    delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
    return query select null::uuid, 'rejected';
    return;
  end if;
  if lower(coalesce(p_currency, '')) is distinct from lower(v_cart.currency)
     or p_amount_total is null
     or p_amount_total < v_cart.total_cents then
    delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
    return query select null::uuid, 'underpaid';
    return;
  end if;
  if p_amount_total <> v_cart.total_cents
     or v_tax_sum <> p_amount_total - v_discounted
     or v_cart.total_cents <> v_discounted + v_tax_sum then
    delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
    return query select null::uuid, 'rejected';
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

  -- Inventory: every capped line must still fit, counting paid orders only (the hold is this payment's own).
  if v_status in ('paid', 'partially-refunded', 'disputed') then
    for v_line in
      select l->>'tierId' as tier_id, (l->>'quantity')::int as qty
      from jsonb_array_elements(v_snap->'lines') l
      order by 1
    loop
      select * into v_tier from tiers where event_id = v_cart.event_id and tier_id = v_line.tier_id;
      if v_tier.capacity is not null and public.tier_sold(v_cart.event_id, v_line.tier_id) + v_line.qty > v_tier.capacity then
        delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
        return query select null::uuid, 'oversold';
        return;
      end if;
    end loop;
  end if;

  v_ticket_status := case when v_status in ('refunded', 'disputed') then 'cancelled' else 'valid' end;

  if v_lines = 1 then
    select l->>'tierId', l->>'name' into v_tier_id, v_tier_name from jsonb_array_elements(v_snap->'lines') l limit 1;
  else
    v_tier_id := 'mixed';
    select string_agg((l->>'name') || ' × ' || (l->>'quantity'), ', ' order by (l->>'position')::int)
      into v_tier_name from jsonb_array_elements(v_snap->'lines') l;
  end if;

  insert into orders (
    stripe_session_id, stripe_payment_intent, event_id, tier_id, tier_name, quantity,
    purchaser_name, purchaser_email, amount_total, currency, status,
    promotion_id, promo_code, discount_percent,
    original_subtotal_cents, discount_amount_cents, discounted_subtotal_cents, tax_cents, final_total_cents
  ) values (
    p_session_id, p_payment_intent, v_cart.event_id, v_tier_id, v_tier_name, v_units,
    nullif(trim(p_name), ''), trim(p_email), p_amount_total, lower(p_currency), v_status,
    v_promo.id, v_promo.code, case when v_promo.id is null then null else v_percent end,
    v_original, v_discount, v_discounted, p_amount_total - v_discounted, p_amount_total
  )
  returning id into v_order_id;

  insert into order_items (
    order_id, event_id, position, tier_id, display_name_snapshot, unit_price_cents, quantity,
    admissions_per_unit, total_admissions, original_line_subtotal_cents, promo_eligible,
    eligible_discount_cents, discounted_line_subtotal_cents, tax_cents, line_total_cents
  )
  select v_order_id, v_cart.event_id, (l->>'position')::int, l->>'tierId', l->>'name',
         (l->>'unitCents')::int, (l->>'quantity')::int, (l->>'admissionsPerUnit')::int,
         (l->>'quantity')::int * (l->>'admissionsPerUnit')::int,
         (l->>'originalLineCents')::int, (l->>'promoEligible')::boolean,
         (l->>'discountCents')::int, (l->>'discountedLineCents')::int,
         (l->>'taxCents')::int, (l->>'discountedLineCents')::int + (l->>'taxCents')::int
  from jsonb_array_elements(v_snap->'lines') l;

  -- One pass per admission, numbered through the order in line order.
  insert into tickets (order_id, event_id, tier_id, guest_number, status)
  select v_order_id, v_cart.event_id, i.tier_id,
         (row_number() over (order by i.position, g.n))::int, v_ticket_status
  from order_items i
  cross join lateral generate_series(1, i.total_admissions) as g(n)
  where i.order_id = v_order_id;

  delete from checkout_holds where payment_intent_id = p_payment_intent or cart_id = p_cart_id;
  return query select v_order_id, 'created';
exception
  when unique_violation then
    select o.id into v_order_id from orders o
     where o.stripe_payment_intent = p_payment_intent or o.stripe_session_id = p_session_id
     limit 1;
    return query select v_order_id, 'exists';
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    return query select null::uuid, 'rejected';
end;
$$;

-- ── Scanner label ────────────────────────────────────────────────────────────
-- Only the label changes: a pass in a mixed order is named for its own ticket
-- type. Orders without order_items return o.tier_name exactly as before.

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
  checked_in_by text,
  guest_name text
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
         coalesce(oi.display_name_snapshot, o.tier_name), o.purchaser_name, v_ticket.checked_in_at, v_ticket.checked_in_by,
         v_ticket.guest_name
  from (select 1) s
  left join orders o on o.id = v_ticket.order_id
  left join order_items oi on oi.order_id = v_ticket.order_id and oi.tier_id = v_ticket.tier_id;
end;
$$;

revoke execute on function
  public.reserve_cart(text, jsonb, text, jsonb, text, int),
  public.create_cart_order(text, text, uuid, text, text, int, text),
  public.lock_checkout_cart(),
  public.lock_order_items()
from public, anon, authenticated;

grant execute on function
  public.reserve_cart(text, jsonb, text, jsonb, text, int),
  public.create_cart_order(text, text, uuid, text, text, int, text)
to service_role;

notify pgrst, 'reload schema';
