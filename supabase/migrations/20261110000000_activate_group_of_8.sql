-- Activate the existing Group of 8 tier for Diwali Night. Data only: no schema change.
--
-- The row already exists (id group-8, 13999 cents, admits 8, up to 10 per line) and has
-- sold nothing. It is switched on only if it still matches that price and admission count,
-- so a row someone edited since is left alone. Safe to run twice. Environments without the
-- row (a fresh database) update nothing.

update public.tiers
   set active = true
 where event_id = 'evt_diwali_night'
   and tier_id = 'group-8'
   and price_cents = 13999
   and currency = 'usd'
   and admits = 8
   and opens_after is null
   and active = false;
