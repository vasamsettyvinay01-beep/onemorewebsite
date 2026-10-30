import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261030120000_house_party_rsvps.sql", import.meta.url), "utf8");
const functionSource = readFileSync(new URL("../supabase/functions/house-party/index.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/lib/house-party.ts", import.meta.url), "utf8");
const formSource = readFileSync(new URL("../src/components/house-party/HousePartyRsvpExperience.tsx", import.meta.url), "utf8");
const announcementSource = readFileSync(new URL("../src/components/house-party/HousePartyAnnouncement.tsx", import.meta.url), "utf8");

test("House Party capacity is isolated and transaction-safe", () => {
  assert.match(migration, /create table public\.house_party_events/);
  assert.match(migration, /create table public\.house_party_rsvps/);
  assert.match(migration, /capacity int not null check \(capacity > 0/);
  assert.match(migration, /party_size int not null check \(party_size between 1 and 4\)/);
  assert.match(migration, /where slug = p_slug\s+for update;/);
  assert.match(migration, /v_confirmed \+ p_party_size > v_event\.capacity/);
  assert.match(migration, /status = 'confirmed'/);
  assert.match(migration, /house_party_rsvps_confirmed_email_idx/);
  assert.match(migration, /house_party_rsvps_confirmed_phone_idx/);
  assert.match(migration, /now\(\) >= v_event\.expires_at/);
  assert.match(migration, /grant execute on function public\.create_house_party_rsvp[\s\S]*to service_role/);
});

test("House Party public function enforces consent and only exposes safe outcomes", () => {
  assert.match(functionSource, /body\.ageConfirmed !== true/);
  assert.match(functionSource, /p_party_size: partySize/);
  assert.match(functionSource, /p_guest_names: guestNames/);
  assert.match(functionSource, /case "duplicate"/);
  assert.match(functionSource, /case "insufficient_capacity"/);
  assert.match(functionSource, /case "full"/);
  assert.match(functionSource, /case "ended"/);
  assert.doesNotMatch(functionSource, /address|location/i);
});

test("House Party messaging uses actual people remaining", () => {
  assert.match(helperSource, /if \(spots === 1\) return "1 SPOT LEFT"/);
  assert.match(helperSource, /return `ONLY \$\{spots\} SPOTS LEFT`/);
  assert.match(helperSource, /return `\$\{spots\} SPOTS LEFT`/);
  assert.match(formSource, /Only 30 People/);
  assert.match(formSource, /We'll send the private location to your RSVP contact details/);
  assert.match(formSource, /everyone in my RSVP must be 21\+/);
  assert.match(formSource, /Get Nov 7 Tickets/);
  assert.match(formSource, /role="listbox"/);
  assert.match(announcementSource, /getHousePartyStatus/);
  assert.match(announcementSource, /status\.state === "ended"\) return null/);
});
