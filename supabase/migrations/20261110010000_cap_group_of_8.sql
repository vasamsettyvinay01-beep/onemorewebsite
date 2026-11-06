-- Temporary sales cap: Group of 8 limited to 3 packages (3 x 8 = 24 admissions).
-- tiers.capacity counts packages (order units), not admissions. This is an operational
-- limit, not the venue's capacity. Data only: no schema change.
--
-- Applied only to the existing row while it is still the uncapped $139.99 / 8-admission
-- tier and has not already sold or held more than 3 packages. Safe to run twice.

update public.tiers
   set capacity = 3
 where event_id = 'evt_diwali_night'
   and tier_id = 'group-8'
   and price_cents = 13999
   and admits = 8
   and capacity is null
   and public.tier_sold('evt_diwali_night', 'group-8') + public.tier_held('evt_diwali_night', 'group-8') <= 3;
