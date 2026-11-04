-- Complimentary admissions are their own pass type. They no longer borrow a
-- public ticket tier. One issuance still creates one order and one QR ticket
-- per guest. Paid inventory, Stripe, and check-in are unchanged.

set lock_timeout = '4s';
set statement_timeout = '60s';

alter table public.orders
  add column if not exists purchaser_phone text,
  add column if not exists issued_by uuid references auth.users (id) on delete set null;

alter table public.orders
  drop constraint if exists orders_purchaser_phone_check;

alter table public.orders
  add constraint orders_purchaser_phone_check
  check (purchaser_phone is null or char_length(purchaser_phone) between 7 and 40);

alter table public.orders
  drop constraint if exists orders_complimentary_quantity_check;

alter table public.orders
  add constraint orders_complimentary_quantity_check
  check (not is_complimentary or quantity between 1 and 10);

drop function if exists public.issue_complimentary_tickets(text, text, text, text, int, text);

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
    currency, status, is_test, is_complimentary, issued_by
  ) values (
    v_session_id, null, p_event_id, 'complimentary', 'Complimentary Admission',
    p_ticket_count, v_name, v_email, v_phone, 0,
    'usd', 'paid', false, true, p_issued_by
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

revoke execute on function
  public.issue_complimentary_tickets(text, text, text, text, int, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.issue_complimentary_tickets(text, text, text, text, int, text, uuid)
to service_role;
