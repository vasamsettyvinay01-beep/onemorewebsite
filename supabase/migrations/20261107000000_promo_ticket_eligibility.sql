-- Each promotion names the ticket tiers it can discount.
-- Existing orders are not read or written. Their price snapshots stay immutable.

set lock_timeout = '4s';
set statement_timeout = '60s';

alter table public.promotions
  add column eligible_tier_ids text[] not null default '{}';

update public.promotions
set eligible_tier_ids = array['female', 'general']
where event_id = 'evt_diwali_night'
  and code = 'GISO15'
  and eligible_tier_ids = '{}';

alter table public.promotions
  add constraint promotions_eligible_tier_ids_check
  check (
    cardinality(eligible_tier_ids) between 1 and 32
    and eligible_tier_ids::text ~ '^\{([a-z0-9_-]{1,64})(,[a-z0-9_-]{1,64})*\}$'
  );

alter table public.promotions
  alter column eligible_tier_ids drop default;

notify pgrst, 'reload schema';
