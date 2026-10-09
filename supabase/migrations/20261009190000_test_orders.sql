-- Marks pre-launch test orders so reporting can leave them out.
-- Additive. No order, ticket, payment, or scan row is deleted or repriced.

set lock_timeout = '4s';
set statement_timeout = '60s';

alter table public.orders add column is_test boolean not null default false;

do $$
declare
  v_count int;
begin
  update public.orders
     set is_test = true
   where status = 'refunded'
     and left(replace(id::text, '-', ''), 8) in (
       '0f2c9d3b', '9e2b87fe', '6b461729', '24cbccc6', '1834c033', '3050a8f7',
       '8a0e3e88', '9b148667', '3326549d', 'd09c410f', 'c577c949', '9d9357b2',
       'e00c708d', '162c49ca', 'fae12ce9', '72d8bc39', 'c23e9faf'
     );
  get diagnostics v_count = row_count;
  if v_count <> 17 then
    raise exception 'expected 17 test orders, matched %', v_count;
  end if;
  if exists (select 1 from public.orders where is_test and status <> 'refunded') then
    raise exception 'a paid order was marked as test';
  end if;
end;
$$;

create index orders_event_live_idx on public.orders (event_id, created_at desc) where not is_test;
