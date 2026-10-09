-- Server-side source of truth for what each ticket costs and admits, used by
-- the `checkout` function to price PaymentIntents. Written by
-- scripts/stripe-setup.ts from src/data/events.ts; never read by browsers.

create table public.tiers (
  event_id text not null,
  tier_id text not null,
  name text not null,
  price_cents int not null check (price_cents > 0),
  currency text not null,
  admits int not null default 1 check (admits > 0),
  capacity int,
  max_per_order int not null default 10,
  active boolean not null default true,
  -- Display details copied onto each PaymentIntent (event name, date, venue…).
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (event_id, tier_id)
);

alter table public.tiers enable row level security;
revoke all on public.tiers from anon, authenticated;
