-- Adds a confirmation pass token and email timestamp.
-- Does not change capacity locking, duplicate checks, or expiry.

alter table public.house_party_rsvps
  add column if not exists confirmation_token text,
  add column if not exists email_sent_at timestamptz;

create unique index if not exists house_party_rsvps_confirmation_token_idx
  on public.house_party_rsvps (confirmation_token)
  where confirmation_token is not null;
