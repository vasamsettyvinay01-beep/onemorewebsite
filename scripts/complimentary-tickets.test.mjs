import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261019000000_complimentary_tickets.sql", import.meta.url),
  "utf8",
);
const admissions = readFileSync(
  new URL("../supabase/migrations/20261106000000_complimentary_admissions.sql", import.meta.url),
  "utf8",
);
const panel = readFileSync(new URL("../src/components/admin/ComplimentaryPanel.tsx", import.meta.url), "utf8");
const email = readFileSync(new URL("../supabase/functions/_shared/complimentary-email.ts", import.meta.url), "utf8");
const door = readFileSync(new URL("../src/components/door/DoorApp.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../supabase/functions/admin/index.ts", import.meta.url), "utf8");
const orderEmail = readFileSync(new URL("../supabase/functions/_shared/order-email.ts", import.meta.url), "utf8");
const checkIn = readFileSync(
  new URL("../supabase/migrations/20261011120000_guest_names.sql", import.meta.url),
  "utf8",
);

test("complimentary issuance creates exactly the requested number of valid QR tickets", () => {
  assert.match(migration, /create or replace function public\.issue_complimentary_tickets/);
  assert.match(migration, /generate_series\(1, p_ticket_count\)/);
  assert.doesNotMatch(migration, /p_ticket_count \* .*admits/);
  assert.match(migration, /p_ticket_count > 50/);
  assert.match(migration, /select v_order\.id, 'exists'/);
  assert.match(migration, /'idempotency_mismatch'/);
  assert.match(migration, /select v_order\.id, p_event_id, p_tier_id, guest_number, 'valid'/);
});

test("complimentary tickets stay outside inventory and revenue", () => {
  assert.match(migration, /add column is_complimentary boolean not null default false/);
  assert.match(migration, /amount_total = 0 and stripe_payment_intent is null/);
  assert.match(migration, /and not is_complimentary/);
  assert.match(migration, /and not o\.is_complimentary/);
  assert.match(admin, /\.eq\("is_complimentary", false\)/);
  assert.match(admin, /\.eq\("is_complimentary", true\)/);
});

test("email delivery is claimed once and becomes retryable after failure", () => {
  assert.match(orderEmail, /\.is\("emailed_at", null\)/);
  assert.match(orderEmail, /if \(!claim\.data\?\.length\)/);
  assert.match(orderEmail, /update\(\{ emailed_at: null \}\)/);
  assert.match(admin, /Use Retry email from the history below/);
  assert.match(admin, /case "resend_complimentary"/);
});

test("new complimentary issuances are not public ticket types", () => {
  assert.match(admissions, /drop function if exists public\.issue_complimentary_tickets\(text, text, text, text, int, text\)/);
  assert.match(admissions, /p_ticket_count > 10/);
  assert.match(admissions, /check \(not is_complimentary or quantity between 1 and 10\)/);
  assert.match(admissions, /'complimentary', 'Complimentary Admission'/);
  assert.match(admissions, /generate_series\(1, p_ticket_count\)/);
  assert.doesNotMatch(admissions, /from tiers/);
  assert.doesNotMatch(panel, /Ticket type|Male|Female|Couple|Group of 5/);
  assert.match(panel, /Send \$\{ticketCount\} complimentary ticket/);
  assert.match(email, /Your Complimentary Invitation/);
  assert.match(email, /Pass \$\{pass\.number\}/);
  assert.match(email, /Admits 1 guest/);
  assert.doesNotMatch(email, /\$\d|\bprice\b|\bsubtotal\b|\btax\b|\bdiscount\b|\bcheckout\b|\bpayment\b|\bfree\b/i);
  assert.match(door, /complimentary && result\.outcome === "admitted" \? "Used"/);
  assert.match(door, /Check-in successful/);
  assert.match(admin, /p_issued_by: actor\.id/);
  assert.doesNotMatch(admin.slice(admin.indexOf("async function issueComplimentary"), admin.indexOf("async function resendComplimentary")), /p_tier_id|stripe/);
});

test("complimentary QR tickets use the unchanged atomic check-in path", () => {
  assert.match(checkIn, /where t\.token = p_token and t\.status = 'valid' and t\.event_id = p_event_id/);
  assert.match(checkIn, /set status = 'checked-in'/);
  assert.doesNotMatch(checkIn, /is_complimentary/);
});
