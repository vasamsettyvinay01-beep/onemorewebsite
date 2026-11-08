-- Online checkout stops at 360 admissions for Indian Diwali Night.
-- One admission is one person (a Couple hold of 1 is 2, a Group of 5 hold of 1 is 5).
-- Cash sales and complimentary passes are not online sales, so they do not
-- count and this cap does not block them. Live checkout holds do count, so
-- two people paying at once cannot both pass a full cap.
-- The check runs when a hold is created. A payment already holding its
-- tickets can still complete, and releasing a hold frees the spots.

set lock_timeout = '4s';
set statement_timeout = '60s';

create table public.event_online_caps (
  event_id text primary key,
  admissions int not null check (admissions > 0)
);

alter table public.event_online_caps enable row level security;
revoke all on public.event_online_caps from anon, authenticated;

insert into public.event_online_caps (event_id, admissions)
values ('evt_diwali_night', 360);

create or replace function public.online_admissions_committed(p_event_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((
      select count(*)
      from tickets t
      join orders o on o.id = t.order_id
      where t.event_id = p_event_id
        and t.status in ('valid', 'checked-in')
        and o.status <> 'refunded'
        and not o.is_complimentary
        and not o.is_test
        and o.payment_method is distinct from 'cash'
    ), 0)
    + coalesce((
      select sum(h.quantity * greatest(t.admits, 1))
      from checkout_holds h
      join tiers t on t.event_id = h.event_id and t.tier_id = h.tier_id
      where h.event_id = p_event_id
        and h.cart_id is null
        and h.expires_at > now()
    ), 0)
    + coalesce((
      select sum(hi.quantity * greatest(t.admits, 1))
      from checkout_hold_items hi
      join checkout_holds h on h.id = hi.hold_id
      join tiers t on t.event_id = hi.event_id and t.tier_id = hi.tier_id
      where h.event_id = p_event_id
        and h.expires_at > now()
    ), 0)
  )::int;
$$;

create or replace function public.online_sale_room(p_event_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cap', (select c.admissions from event_online_caps c where c.event_id = p_event_id),
    'committed', public.online_admissions_committed(p_event_id)
  );
$$;

create or replace function public.enforce_online_admission_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_committed int;
begin
  select admissions into v_cap
  from event_online_caps
  where event_id = new.event_id
  for update;
  if v_cap is null then
    return new;
  end if;
  v_committed := public.online_admissions_committed(new.event_id);
  if v_committed > v_cap then
    raise exception 'sold_out:online';
  end if;
  return new;
end;
$$;

create trigger checkout_holds_online_cap
after insert on public.checkout_holds
for each row execute function public.enforce_online_admission_cap();

create trigger checkout_hold_items_online_cap
after insert on public.checkout_hold_items
for each row execute function public.enforce_online_admission_cap();

revoke all on function public.online_admissions_committed(text) from public, anon, authenticated;
revoke all on function public.online_sale_room(text) from public, anon, authenticated;
revoke all on function public.enforce_online_admission_cap() from public, anon, authenticated;

grant execute on function public.online_admissions_committed(text) to service_role;
grant execute on function public.online_sale_room(text) to service_role;

notify pgrst, 'reload schema';
