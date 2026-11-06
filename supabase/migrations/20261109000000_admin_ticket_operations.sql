-- Super-admin ticket operations.
-- Complimentary passes can be revoked one at a time, or the unused remainder of an issuance.
-- A used pass stays used. Nothing is deleted.
-- A cash sale is a real paid order: same prices, same inventory, same tickets, no Stripe object.

set lock_timeout = '4s';
set statement_timeout = '60s';

-- ── Pass and scan states ─────────────────────────────────────────────────────

alter table public.tickets
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users (id) on delete set null;

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets
  add constraint tickets_status_check
  check (status in ('valid', 'checked-in', 'cancelled', 'revoked'));

alter table public.tickets drop constraint if exists tickets_revoked_pair_check;
alter table public.tickets
  add constraint tickets_revoked_pair_check
  check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  );

alter table public.scans drop constraint if exists scans_outcome_check;
alter table public.scans
  add constraint scans_outcome_check
  check (outcome in ('admitted', 'already-used', 'cancelled', 'revoked', 'wrong-event', 'not-found'));

-- ── How an order was paid ────────────────────────────────────────────────────

alter table public.orders
  add column if not exists payment_method text,
  add column if not exists cash_received_cents int,
  add column if not exists paid_at timestamptz,
  add column if not exists cash_refunded_at timestamptz,
  add column if not exists cash_refunded_by uuid references auth.users (id) on delete set null,
  add column if not exists cash_refund_cents int;

update public.orders
   set payment_method = case when is_complimentary then 'complimentary' else 'card' end
 where payment_method is null;

alter table public.orders alter column payment_method set default 'card';
alter table public.orders alter column payment_method set not null;

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('card', 'cash', 'complimentary'));

alter table public.orders drop constraint if exists orders_cash_shape_check;
alter table public.orders
  add constraint orders_cash_shape_check
  check (
    (
      payment_method <> 'cash'
      and cash_received_cents is null
      and paid_at is null
      and cash_refunded_at is null
      and cash_refunded_by is null
      and cash_refund_cents is null
    )
    or (
      payment_method = 'cash'
      and stripe_payment_intent is null
      and cash_received_cents = amount_total
      and cash_received_cents > 0
      and paid_at is not null
      and (
        (cash_refund_cents is null and cash_refunded_at is null and cash_refunded_by is null)
        or (cash_refund_cents = cash_received_cents and cash_refunded_at is not null and cash_refunded_by is not null)
      )
    )
  );

-- New complimentary issuances are not card payments.
create or replace function public.issue_complimentary_tickets(
  p_event_id text,
  p_name text,
  p_email text,
  p_phone text,
  p_ticket_count int,
  p_idempotency_key text,
  p_issued_by uuid
) returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_session_id text;
begin
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{1,80}$'
     or char_length(v_name) not between 2 and 80
     or char_length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (v_phone is not null and char_length(v_phone) not between 7 and 40)
     or p_ticket_count is null or p_ticket_count < 1 or p_ticket_count > 10
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return query select null::uuid, 'rejected';
    return;
  end if;

  v_session_id := 'comp_' || p_idempotency_key;

  select * into v_order from orders where stripe_session_id = v_session_id;
  if found then
    if v_order.is_complimentary
       and v_order.event_id = p_event_id
       and v_order.tier_id = 'complimentary'
       and v_order.quantity = p_ticket_count
       and lower(v_order.purchaser_email) = v_email
       and coalesce(v_order.purchaser_name, '') = v_name then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
    return;
  end if;

  insert into orders (
    stripe_session_id, stripe_payment_intent, event_id, tier_id, tier_name,
    quantity, purchaser_name, purchaser_email, purchaser_phone, amount_total,
    currency, status, is_test, is_complimentary, issued_by, payment_method
  ) values (
    v_session_id, null, p_event_id, 'complimentary', 'Complimentary Admission',
    p_ticket_count, v_name, v_email, v_phone, 0,
    'usd', 'paid', false, true, p_issued_by, 'complimentary'
  )
  returning * into v_order;

  insert into tickets (order_id, event_id, tier_id, guest_number, status)
  select v_order.id, p_event_id, 'complimentary', guest_number, 'valid'
  from generate_series(1, p_ticket_count) as guest_number;

  return query select v_order.id, 'created';
exception
  when unique_violation then
    select * into v_order from orders where stripe_session_id = v_session_id;
    if found
       and v_order.is_complimentary
       and v_order.event_id = p_event_id
       and v_order.tier_id = 'complimentary'
       and v_order.quantity = p_ticket_count
       and lower(v_order.purchaser_email) = v_email
       and coalesce(v_order.purchaser_name, '') = v_name then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
end;
$$;

-- ── Complimentary revocation ─────────────────────────────────────────────────

create or replace function public.revoke_complimentary_pass(
  p_event_id text,
  p_order_id uuid,
  p_guest_number int,
  p_actor uuid
) returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_ticket tickets%rowtype;
begin
  if p_actor is null or p_guest_number is null or p_guest_number < 1 or p_guest_number > 10 then
    return query select 'rejected';
    return;
  end if;

  select * into v_order
    from orders
   where id = p_order_id
     and event_id = p_event_id
     and is_complimentary
     and not is_test
   for update;
  if not found then
    return query select 'not_found';
    return;
  end if;

  select * into v_ticket
    from tickets
   where order_id = v_order.id
     and guest_number = p_guest_number
   for update;
  if not found then
    return query select 'not_found';
    return;
  end if;
  if v_ticket.status = 'checked-in' then
    return query select 'used';
    return;
  end if;
  if v_ticket.status = 'revoked' then
    return query select 'already_revoked';
    return;
  end if;
  if v_ticket.status <> 'valid' then
    return query select 'rejected';
    return;
  end if;

  update tickets
     set status = 'revoked', revoked_at = now(), revoked_by = p_actor
   where id = v_ticket.id and status = 'valid';
  return query select 'revoked';
end;
$$;

create or replace function public.revoke_complimentary_remaining(
  p_event_id text,
  p_order_id uuid,
  p_actor uuid
) returns table (outcome text, revoked_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_count int := 0;
begin
  if p_actor is null then
    return query select 'rejected', 0;
    return;
  end if;

  select * into v_order
    from orders
   where id = p_order_id
     and event_id = p_event_id
     and is_complimentary
     and not is_test
   for update;
  if not found then
    return query select 'not_found', 0;
    return;
  end if;

  update tickets
     set status = 'revoked', revoked_at = now(), revoked_by = p_actor
   where order_id = v_order.id and status = 'valid';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return query select 'none_remaining', 0;
  else
    return query select 'revoked', v_count;
  end if;
end;
$$;

-- ── Cash sale ────────────────────────────────────────────────────────────────
-- Prices, admissions and the promo discount are recomputed from tier and
-- promotion rows. Tax is the amount already quoted by Stripe Tax and must add
-- up. A failure returns before any insert, so a mixed sale cannot be partial.
-- The same idempotency key returns the existing order and creates nothing else.

create or replace function public.create_cash_order(
  p_event_id text,
  p_items jsonb,
  p_snapshot jsonb,
  p_name text,
  p_email text,
  p_phone text,
  p_idempotency_key text,
  p_issued_by uuid
) returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_session_id text;
  v_order orders%rowtype;
  v_line record;
  v_tier tiers%rowtype;
  v_gate tiers%rowtype;
  v_promo promotions%rowtype;
  v_promo_id uuid;
  v_promo_code text;
  v_eligible text[] := array[]::text[];
  v_percent int;
  v_lines int;
  v_units int := 0;
  v_admissions int := 0;
  v_original int := 0;
  v_discount int := 0;
  v_discounted int := 0;
  v_tax_sum int := 0;
  v_expected int;
  v_order_id uuid;
  v_tier_id text;
  v_tier_name text;
begin
  if p_issued_by is null
     or p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{1,80}$'
     or char_length(v_name) not between 2 and 80
     or char_length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (v_phone is not null and char_length(v_phone) not between 7 and 40)
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$'
     or p_snapshot is null or jsonb_typeof(p_snapshot->'lines') <> 'array' then
    return query select null::uuid, 'rejected';
    return;
  end if;

  v_session_id := 'cash_' || p_idempotency_key;
  v_lines := jsonb_array_length(p_snapshot->'lines');
  if v_lines is null or v_lines < 1 or v_lines > 8
     or jsonb_array_length(p_items) is distinct from v_lines then
    return query select null::uuid, 'rejected';
    return;
  end if;

  select * into v_order from orders where stripe_session_id = v_session_id;
  if found then
    if v_order.payment_method = 'cash'
       and v_order.event_id = p_event_id
       and lower(v_order.purchaser_email) = v_email
       and coalesce(v_order.purchaser_name, '') = v_name
       and v_order.amount_total = (p_snapshot->>'total')::int then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
    return;
  end if;

  for v_line in
    select l->>'tierId' as tier_id
    from jsonb_array_elements(p_snapshot->'lines') l
    order by 1
  loop
    if v_line.tier_id in ('vip', 'complimentary', 'mixed') then
      return query select null::uuid, 'unavailable';
      return;
    end if;
    select * into v_tier
      from tiers
     where event_id = p_event_id and tier_id = v_line.tier_id
     for update;
    if not found or not v_tier.active then
      return query select null::uuid, 'unavailable';
      return;
    end if;
  end loop;

  select * into v_order from orders where stripe_session_id = v_session_id;
  if found then
    return query select v_order.id, 'exists';
    return;
  end if;

  if p_snapshot->'promo' is not null and jsonb_typeof(p_snapshot->'promo') = 'object' then
    v_percent := (p_snapshot->'promo'->>'percent')::int;
    select * into v_promo from promotions
     where id = (p_snapshot->'promo'->>'id')::uuid
       and code = p_snapshot->'promo'->>'code'
       and event_id = p_event_id
       and discount_type = 'percentage'
       and active;
    if not found or v_percent is null or v_percent < 1 or v_percent > 100
       or v_percent is distinct from v_promo.discount_value then
      return query select null::uuid, 'rejected';
      return;
    end if;
    v_eligible := coalesce(v_promo.eligible_tier_ids, array[]::text[]);
    v_promo_id := v_promo.id;
    v_promo_code := v_promo.code;
  end if;

  for v_line in
    select (l->>'position')::int as position, l->>'tierId' as tier_id, l->>'name' as name,
           (l->>'unitCents')::int as unit, (l->>'quantity')::int as qty,
           (l->>'admissionsPerUnit')::int as admits,
           (l->>'originalLineCents')::int as original, (l->>'discountCents')::int as discount,
           (l->>'discountedLineCents')::int as discounted, (l->>'taxCents')::int as tax
    from jsonb_array_elements(p_snapshot->'lines') l
  loop
    select * into v_tier from tiers where event_id = p_event_id and tier_id = v_line.tier_id;
    if not found or not v_tier.active or v_tier.tier_id in ('vip', 'complimentary', 'mixed') then
      return query select null::uuid, 'unavailable';
      return;
    end if;
    if v_tier.opens_after is not null then
      select * into v_gate from tiers where event_id = p_event_id and tier_id = v_tier.opens_after;
      if found and v_gate.active and (v_gate.capacity is null or public.tier_sold(p_event_id, v_gate.tier_id) < v_gate.capacity) then
        return query select null::uuid, 'unavailable';
        return;
      end if;
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_snapshot->'lines') other
      where other->>'tierId' = v_line.tier_id and (other->>'position')::int is distinct from v_line.position
    ) then
      return query select null::uuid, 'rejected';
      return;
    end if;
    if v_line.qty is null or v_line.qty < 1 or v_line.qty > least(v_tier.max_per_order, 10)
       or v_line.unit is distinct from v_tier.price_cents
       or v_line.admits is distinct from v_tier.admits
       or v_line.name is distinct from v_tier.name
       or v_line.original is distinct from v_tier.price_cents * v_line.qty
       or v_line.tax is null or v_line.tax < 0 then
      return query select null::uuid, 'rejected';
      return;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(p_items) i
      where i->>'tier_id' = v_line.tier_id and (i->>'quantity')::int = v_line.qty
    ) then
      return query select null::uuid, 'rejected';
      return;
    end if;
    v_expected := 0;
    if v_percent is not null and v_line.tier_id = any(v_eligible) then
      v_expected := (v_line.original * v_percent + 50) / 100;
    end if;
    if v_line.discount is distinct from v_expected
       or v_line.discounted is distinct from v_line.original - v_expected then
      return query select null::uuid, 'rejected';
      return;
    end if;
    if v_tier.capacity is not null
       and public.tier_sold(p_event_id, v_tier.tier_id) + public.tier_held(p_event_id, v_tier.tier_id) + v_line.qty > v_tier.capacity then
      return query select null::uuid, 'oversold';
      return;
    end if;
    v_units := v_units + v_line.qty;
    v_admissions := v_admissions + v_line.qty * v_tier.admits;
    v_original := v_original + v_line.original;
    v_discount := v_discount + v_line.discount;
    v_discounted := v_discounted + v_line.discounted;
    v_tax_sum := v_tax_sum + v_line.tax;
  end loop;

  if v_admissions > 20
     or v_original is distinct from (p_snapshot->>'originalSubtotal')::int
     or v_discount is distinct from (p_snapshot->>'discount')::int
     or v_discounted is distinct from (p_snapshot->>'discountedSubtotal')::int
     or v_tax_sum is distinct from (p_snapshot->>'tax')::int
     or (p_snapshot->>'total')::int is distinct from v_discounted + v_tax_sum
     or lower(coalesce(p_snapshot->>'currency', '')) <> 'usd' then
    return query select null::uuid, 'rejected';
    return;
  end if;

  if v_lines = 1 then
    select l->>'tierId', l->>'name' into v_tier_id, v_tier_name
      from jsonb_array_elements(p_snapshot->'lines') l limit 1;
  else
    v_tier_id := 'mixed';
    select string_agg((l->>'name') || ' × ' || (l->>'quantity'), ', ' order by (l->>'position')::int)
      into v_tier_name from jsonb_array_elements(p_snapshot->'lines') l;
  end if;

  insert into orders (
    stripe_session_id, stripe_payment_intent, event_id, tier_id, tier_name, quantity,
    purchaser_name, purchaser_email, purchaser_phone, amount_total, currency, status,
    is_test, is_complimentary, issued_by, payment_method, cash_received_cents, paid_at,
    promotion_id, promo_code, discount_percent,
    original_subtotal_cents, discount_amount_cents, discounted_subtotal_cents, tax_cents, final_total_cents
  ) values (
    v_session_id, null, p_event_id, v_tier_id, v_tier_name, v_units,
    v_name, v_email, v_phone, v_discounted + v_tax_sum, 'usd', 'paid',
    false, false, p_issued_by, 'cash', v_discounted + v_tax_sum, now(),
    v_promo_id, v_promo_code, case when v_promo_id is null then null else v_percent end,
    v_original, v_discount, v_discounted, v_tax_sum, v_discounted + v_tax_sum
  )
  returning id into v_order_id;

  insert into order_items (
    order_id, event_id, position, tier_id, display_name_snapshot, unit_price_cents, quantity,
    admissions_per_unit, total_admissions, original_line_subtotal_cents, promo_eligible,
    eligible_discount_cents, discounted_line_subtotal_cents, tax_cents, line_total_cents
  )
  select v_order_id, p_event_id, (l->>'position')::int, l->>'tierId', l->>'name',
         (l->>'unitCents')::int, (l->>'quantity')::int, (l->>'admissionsPerUnit')::int,
         (l->>'quantity')::int * (l->>'admissionsPerUnit')::int,
         (l->>'originalLineCents')::int,
         (l->>'tierId') = any(v_eligible),
         (l->>'discountCents')::int, (l->>'discountedLineCents')::int,
         (l->>'taxCents')::int, (l->>'discountedLineCents')::int + (l->>'taxCents')::int
  from jsonb_array_elements(p_snapshot->'lines') l;

  insert into tickets (order_id, event_id, tier_id, guest_number, status)
  select v_order_id, p_event_id, i.tier_id,
         (row_number() over (order by i.position, g.n))::int, 'valid'
  from order_items i
  cross join lateral generate_series(1, i.total_admissions) as g(n)
  where i.order_id = v_order_id;

  return query select v_order_id, 'created';
exception
  when unique_violation then
    select * into v_order from orders where stripe_session_id = v_session_id;
    if found
       and v_order.payment_method = 'cash'
       and v_order.event_id = p_event_id
       and lower(v_order.purchaser_email) = v_email then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    return query select null::uuid, 'rejected';
end;
$$;

-- A cash refund never calls Stripe. It is all or nothing: if any pass on the
-- order is already checked in, the refund is refused. The order stays paid,
-- every pass stays as it is, and inventory is not restored.
-- Card refunds are unchanged. cancel_order_by_payment_intent still refunds a
-- paid card order when some passes are checked in: those passes stay checked
-- in, the remaining valid passes are cancelled, and the refunded order drops
-- out of tier_sold. That card behavior is left for a later review.
create or replace function public.refund_cash_order(
  p_event_id text,
  p_order_id uuid,
  p_actor uuid
) returns table (outcome text, cancelled_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_count int := 0;
begin
  if p_actor is null then
    return query select 'rejected', 0;
    return;
  end if;

  select * into v_order
    from orders
   where id = p_order_id and event_id = p_event_id and not is_test
   for update;
  if not found or v_order.payment_method <> 'cash' or v_order.is_complimentary then
    return query select 'not_found', 0;
    return;
  end if;
  if v_order.stripe_payment_intent is not null then
    return query select 'rejected', 0;
    return;
  end if;
  if v_order.status = 'refunded' then
    return query select 'exists', 0;
    return;
  end if;
  if v_order.status <> 'paid' then
    return query select 'rejected', 0;
    return;
  end if;

  -- Hold the passes so a door scan cannot admit one during this refund.
  perform 1 from tickets where order_id = v_order.id for update;
  if exists (
    select 1 from tickets
     where order_id = v_order.id and status = 'checked-in'
  ) then
    return query select 'admitted', 0;
    return;
  end if;

  update orders
     set status = 'refunded',
         cash_refunded_at = now(),
         cash_refunded_by = p_actor,
         cash_refund_cents = cash_received_cents
   where id = v_order.id and status = 'paid';

  update tickets
     set status = 'cancelled'
   where order_id = v_order.id and status = 'valid';
  get diagnostics v_count = row_count;
  return query select 'refunded', v_count;
end;
$$;

-- Scanner: a revoked complimentary pass is its own red result. It is not admitted.
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
      when v_ticket.status = 'revoked' then 'revoked'
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
  public.revoke_complimentary_pass(text, uuid, int, uuid),
  public.revoke_complimentary_remaining(text, uuid, uuid),
  public.create_cash_order(text, jsonb, jsonb, text, text, text, text, uuid),
  public.refund_cash_order(text, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.revoke_complimentary_pass(text, uuid, int, uuid),
  public.revoke_complimentary_remaining(text, uuid, uuid),
  public.create_cash_order(text, jsonb, jsonb, text, text, text, text, uuid),
  public.refund_cash_order(text, uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
