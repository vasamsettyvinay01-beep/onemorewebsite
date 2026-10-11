-- A friend can put their own name on a pass after the buyer sends it.
-- The buyer's passes, QR tokens, and check-in rules stay as they are.
-- guest_name is hospitality. It is never required for admission.

set lock_timeout = '4s';
set statement_timeout = '60s';

alter table public.tickets
  add column guest_name text,
  add column claimed_at timestamptz,
  add constraint tickets_guest_name_len check (guest_name is null or char_length(btrim(guest_name)) between 2 and 60);

alter table public.ticket_shares
  add column opened_at timestamptz;

-- Return type gains guest_name, so the function has to be replaced outright.
drop function if exists public.check_in_ticket(text, text, text, text);

create function public.check_in_ticket(
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
         o.tier_name, o.purchaser_name, v_ticket.checked_in_at, v_ticket.checked_in_by,
         v_ticket.guest_name
  from (select 1) s
  left join orders o on o.id = v_ticket.order_id;
end;
$$;

revoke execute on function public.check_in_ticket(text, text, text, text) from public, anon, authenticated;
grant execute on function public.check_in_ticket(text, text, text, text) to service_role;
