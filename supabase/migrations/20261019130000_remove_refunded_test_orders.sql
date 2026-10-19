-- Removes the 21 pre-launch refunded test purchases, their passes, and door scans.
-- A matching order that is no longer refunded stops the migration.
-- Running it again after the rows are gone does nothing.
-- Paid and complimentary orders are counted before and after and must not change.

set lock_timeout = '4s';
set statement_timeout = '60s';

do $$
declare
  v_ids uuid[];
  v_ticket_ids uuid[];
  v_paid int;
  v_complimentary int;
  v_found int;
begin
  select count(*) into v_paid
  from orders
  where status = 'paid' and not is_complimentary;

  select count(*) into v_complimentary
  from orders
  where is_complimentary;

  select array_agg(id) into v_ids
  from orders
  where status = 'refunded'
    and not is_complimentary
    and left(replace(id::text, '-', ''), 8) in (
      '0f2c9d3b', '9e2b87fe', '6b461729', '24cbccc6', '1834c033', '3050a8f7',
      '8a0e3e88', '9b148667', '3326549d', 'd09c410f', 'c577c949', '9d9357b2',
      'e00c708d', '162c49ca', 'fae12ce9', '72d8bc39', 'c23e9faf', '805d83aa',
      '39e82d8d', 'adb0ec76', '3cc1cebf'
    );

  v_found := coalesce(array_length(v_ids, 1), 0);
  if v_found = 0 then
    return;
  end if;
  if v_found <> 21 then
    raise exception 'expected 21 refunded test orders, found %', v_found;
  end if;
  if exists (
    select 1 from orders
    where id = any(v_ids)
      and (status <> 'refunded' or is_complimentary)
  ) then
    raise exception 'refusing to delete an order that is not a refunded test purchase';
  end if;

  select array_agg(id) into v_ticket_ids
  from tickets
  where order_id = any(v_ids);

  if v_ticket_ids is not null then
    delete from ticket_shares where ticket_id = any(v_ticket_ids);
    delete from scans where ticket_id = any(v_ticket_ids);
  end if;
  delete from tickets where order_id = any(v_ids);
  delete from orders where id = any(v_ids) and status = 'refunded' and not is_complimentary;

  if (select count(*) from orders where status = 'paid' and not is_complimentary) <> v_paid then
    raise exception 'paid orders changed';
  end if;
  if (select count(*) from orders where is_complimentary) <> v_complimentary then
    raise exception 'complimentary orders changed';
  end if;
  if exists (select 1 from orders where id = any(v_ids)) then
    raise exception 'refunded test orders were not removed';
  end if;
end;
$$;
