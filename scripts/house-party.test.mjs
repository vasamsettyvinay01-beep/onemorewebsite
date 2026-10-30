import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { peopleLabel, renderHousePartyCancellationEmail, renderHousePartyEmail, renderHousePartyOrganizerEmail } from "../supabase/functions/_shared/house-party-pass.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20261030120000_house_party_rsvps.sql", import.meta.url), "utf8");
const functionSource = readFileSync(new URL("../supabase/functions/house-party/index.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/lib/house-party.ts", import.meta.url), "utf8");
const formSource = readFileSync(new URL("../src/components/house-party/HousePartyRsvpExperience.tsx", import.meta.url), "utf8");
const announcementSource = readFileSync(new URL("../src/components/house-party/HousePartyAnnouncement.tsx", import.meta.url), "utf8");
const arrivalSource = readFileSync(new URL("../src/lib/house-party-arrival.ts", import.meta.url), "utf8");
const passSource = readFileSync(new URL("../supabase/functions/_shared/house-party-pass.mjs", import.meta.url), "utf8");
const housePartyUi = [formSource, announcementSource, arrivalSource, passSource].join("\n");

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
  assert.match(helperSource, /if \(spots === 1\) return "LAST SPOT"/);
  assert.match(helperSource, /return `ONLY \$\{spots\} SPOTS LEFT`/);
  assert.match(helperSource, /return `\$\{spots\} SPOTS LEFT`/);
  assert.match(formSource, /Only 30 Spots/);
  assert.match(formSource, /Claim Free RSVP/);
  assert.match(formSource, /everyone in my RSVP must be 21\+/);
  assert.match(formSource, /Get Nov 7 Tickets/);
  assert.match(formSource, /role="listbox"/);
  assert.match(announcementSource, /getHousePartyStatus/);
  assert.match(announcementSource, /status\.state === "ended"\) return null/);
  assert.doesNotMatch(housePartyUi, /Pista House|Dumont|Pumpkin|Technology Partners/);
  assert.doesNotMatch(housePartyUi, /\b(apt|unit|suite)\s*#?\s*\d+/i);
});

test("House Party email states the confirmed people and public arrival only", () => {
  for (const count of [1, 2, 4]) {
    const message = renderHousePartyEmail({
      fullName: "Ava Shah",
      partySize: count,
      guestNames: ["Guest One", "Guest Two", "Guest Three"].slice(0, count - 1),
      code: "AB12CD34",
      passUrl: "https://theonemorecompany.com/house-party/pass?t=abc",
      nov7Url: "https://theonemorecompany.com/checkout?event=diwali-night",
      sealUrl: "https://example.com/seal.png",
    });
    assert.equal(message.subject, "YOU'RE IN — Diwali × Halloween House Party 🎃🪔");
    assert.match(message.text, new RegExp(peopleLabel(count).toUpperCase()));
    assert.match(message.html, /FREE ENTRY/);
    assert.match(message.html, /BYOB — BRING YOUR OWN DRINKS/);
    assert.match(message.html, /NOT SELLING ALCOHOL/);
    assert.match(message.html, /Broadstone Amelia/);
    assert.match(message.html, /OPEN ARRIVAL LOCATION/);
    assert.match(message.html, /GET NOV 7 TICKETS/);
    assert.doesNotMatch(message.html, /Pista House|Dumont|Pumpkin|\$0\.00|OPEN BAR|FREE DRINKS/);
    assert.doesNotMatch(message.html, /\b(apt|unit|suite)\s*#?\s*\d+/i);
  }
});

test("House Party organizer mail follows a confirmed RSVP and a cancellation", () => {
  assert.match(functionSource, /case "confirmed"/);
  assert.match(functionSource, /notifyOrganizer\(result\.rsvp_id\)/);
  assert.match(functionSource, /house_party_organizer_email_failed/);
  assert.match(functionSource, /action === "cancel"/);
  assert.match(functionSource, /eq\("status", "confirmed"\)/);
  const deliverPass = functionSource.slice(functionSource.indexOf("async function deliverPass"), functionSource.indexOf("async function passView"));
  const resendPass = functionSource.slice(functionSource.indexOf("async function resendPass"));
  assert.doesNotMatch(deliverPass, /sendHousePartyOrganizerEmail/);
  assert.doesNotMatch(resendPass, /sendHousePartyOrganizerEmail|sendHousePartyCancellationEmail/);

  for (const count of [1, 2, 4]) {
    const message = renderHousePartyOrganizerEmail({
      fullName: "Deepak Kumar Kolipaka",
      partySize: count,
      guestNames: ["Shireesha Gundala", "Guest Two", "Guest Three"].slice(0, count - 1),
      email: "guest@example.com",
      phone: "5550000000",
      instagram: count === 1 ? "" : "@guest",
      rsvpTime: "Fri, Oct 30, 2026, 2:00 PM CDT",
      code: "AB12CD34",
      confirmedPeople: 7,
      capacity: 30,
      spotsRemaining: 23,
      pageUrl: "https://theonemorecompany.com/house-party",
    });
    assert.equal(message.subject, `NEW HOUSE PARTY RSVP — ${peopleLabel(count).toUpperCase()} — Deepak Kumar Kolipaka`);
    assert.match(message.text, /STATUS: CONFIRMED/);
    assert.match(message.text, /CONFIRMED PEOPLE: 7 \/ 30/);
    assert.match(message.text, /SPOTS REMAINING: 23/);
    assert.match(message.text, /21\+ confirmed/i);
    assert.doesNotMatch(message.html, /Pista House|Dumont|Pumpkin|\$0\.00/);
    assert.doesNotMatch(message.html, /\b(apt|unit|suite)\s*#?\s*\d+/i);
  }

  const cancelled = renderHousePartyCancellationEmail({
    fullName: "Deepak Kumar Kolipaka",
    partySize: 2,
    cancelledAt: "Fri, Oct 30, 2026, 2:10 PM CDT",
    confirmedPeople: 5,
    capacity: 30,
    spotsRemaining: 25,
  });
  assert.equal(cancelled.subject, "HOUSE PARTY RSVP CANCELLED — Deepak Kumar Kolipaka");
  assert.match(cancelled.text, /UPDATED CONFIRMED PEOPLE: 5 \/ 30/);
  assert.match(cancelled.text, /UPDATED SPOTS REMAINING: 25/);
  assert.doesNotMatch(cancelled.text, /NEW HOUSE PARTY RSVP/);
});
