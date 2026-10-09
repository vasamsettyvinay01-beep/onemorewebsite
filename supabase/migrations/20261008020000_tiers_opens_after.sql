-- A tier that only goes on sale once another tier has sold out (e.g. Group of 5 after Early Bird).
alter table public.tiers add column opens_after text;
