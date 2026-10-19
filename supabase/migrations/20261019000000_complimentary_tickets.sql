-- Super-admin complimentary issuance. Complimentary passes are valid at the
-- door but stay outside paid inventory, revenue, and general operations reads.

set lock_timeout = '4s';
set statement_timeout = '60s';

alter table public.orders
  add column is_complimentary boolean not null default false,
  add constraint orders_complimentary_payment_check check (
    not is_complimentary
    or (amount_total = 0 and stripe_payment_intent is null and status = 'paid' and not is_test)
  );

create index orders_complimentary_event_idx
  on public.orders (event_id, created_at desc)
  where is_complimentary;

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
    and status <> 'refunded'
    and not is_complimentary;
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
    and not o.is_complimentary
  group by o.tier_id;
$$;

create or replace function public.issue_complimentary_tickets(
  p_event_id text,
  p_tier_id text,
  p_name text,
  p_email text,
  p_ticket_count int,
  p_idempotency_key text
) returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier tiers%rowtype;
  v_order orders%rowtype;
  v_session_id text;
begin
  if p_event_id is null
     or p_tier_id is null
     or p_name is null
     or char_length(btrim(p_name)) not between 2 and 80
     or p_email is null
     or char_length(btrim(p_email)) not between 3 and 320
     or p_ticket_count is null
     or p_ticket_count < 1
     or p_ticket_count > 50
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return query select null::uuid, 'rejected';
    return;
  end if;

  v_session_id := 'comp_' || p_idempotency_key;

  select * into v_order
  from orders
  where stripe_session_id = v_session_id;

  if found then
    if v_order.is_complimentary
       and v_order.event_id = p_event_id
       and v_order.tier_id = p_tier_id
       and v_order.quantity = p_ticket_count
       and lower(v_order.purchaser_email) = lower(btrim(p_email))
       and coalesce(v_order.purchaser_name, '') = btrim(p_name) then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
    return;
  end if;

  select * into v_tier
  from tiers
  where event_id = p_event_id and tier_id = p_tier_id
  for share;

  if not found then
    return query select null::uuid, 'rejected';
    return;
  end if;

  insert into orders (
    stripe_session_id,
    stripe_payment_intent,
    event_id,
    tier_id,
    tier_name,
    quantity,
    purchaser_name,
    purchaser_email,
    amount_total,
    currency,
    status,
    is_test,
    is_complimentary
  ) values (
    v_session_id,
    null,
    p_event_id,
    p_tier_id,
    v_tier.name,
    p_ticket_count,
    btrim(p_name),
    lower(btrim(p_email)),
    0,
    lower(v_tier.currency),
    'paid',
    false,
    true
  )
  returning * into v_order;

  insert into tickets (order_id, event_id, tier_id, guest_number, status)
  select v_order.id, p_event_id, p_tier_id, guest_number, 'valid'
  from generate_series(1, p_ticket_count) as guest_number;

  return query select v_order.id, 'created';
exception
  when unique_violation then
    select * into v_order from orders where stripe_session_id = v_session_id;
    if found
       and v_order.is_complimentary
       and v_order.event_id = p_event_id
       and v_order.tier_id = p_tier_id
       and v_order.quantity = p_ticket_count
       and lower(v_order.purchaser_email) = lower(btrim(p_email))
       and coalesce(v_order.purchaser_name, '') = btrim(p_name) then
      return query select v_order.id, 'exists';
    else
      return query select null::uuid, 'idempotency_mismatch';
    end if;
end;
$$;

revoke execute on function
  public.issue_complimentary_tickets(text, text, text, text, int, text)
from public, anon, authenticated;

grant execute on function
  public.issue_complimentary_tickets(text, text, text, text, int, text)
to service_role;
