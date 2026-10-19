import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { events } from "../src/data/events.ts";
import { renderGuestPassEmail, renderPassEmail } from "../supabase/functions/_shared/pass-email.ts";
import { cleanGuestName } from "../supabase/functions/_shared/guest-name.ts";

const event = events.find((row) => row.slug === "diwali-night");
if (!event) throw new Error("Diwali Night is missing");

const publicTiers = event.ticketTiers.filter((tier) => !tier.hidden && !tier.priceOnRequest);
const checkoutSource = readFileSync(new URL("../src/components/checkout/CheckoutView.tsx", import.meta.url), "utf8");
const checkoutFunction = readFileSync(new URL("../supabase/functions/checkout/index.ts", import.meta.url), "utf8");
const fulfilment = readFileSync(new URL("../supabase/migrations/20261009000000_inventory_and_fulfilment.sql", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("../supabase/functions/_shared/email.ts", import.meta.url), "utf8");
const orderEmail = readFileSync(new URL("../supabase/functions/_shared/order-email.ts", import.meta.url), "utf8");
const ticketsView = readFileSync(new URL("../src/components/ticketing/TicketsView.tsx", import.meta.url), "utf8");

test("the public ticket menu has the intended six choices", () => {
  assert.deepEqual(
    publicTiers.map((tier) => [tier.id, tier.name, tier.admits ?? 1]),
    [
      ["early-bird", "Early Bird", 1],
      ["female", "Female", 1],
      ["general", "Male", 1],
      ["couple", "Couple", 2],
      ["group", "Group of 5", 5],
      ["group-8", "Group of 8", 8],
    ],
  );
  const vip = event.ticketTiers.find((tier) => tier.id === "vip");
  assert.equal(vip?.hidden, true);
  assert.equal(vip?.priceOnRequest, true);
});

test("every tier and quantity produces the exact number of individual passes", () => {
  for (const tier of publicTiers) {
    const admits = tier.admits ?? 1;
    const max = Math.min(tier.maxPerOrder ?? 10, 10);
    for (const quantity of [1, Math.min(2, max), max]) {
      const expected = quantity * admits;
      assert.equal(Number.isInteger(expected), true);
      assert.equal(expected > 0, true);
      assert.equal(expected, quantity * admits);
    }
  }
  assert.match(fulfilment, /generate_series\(1, p_quantity \* v_admits\)/);
  assert.match(webhook, /p_admits: tier\.admits/);
});

test("browser and server enforce quantity limits independently", () => {
  assert.match(checkoutSource, /Math\.min\(tier\?\.maxPerOrder \?\? 10, 10\)/);
  assert.match(checkoutFunction, /quantity > 20/);
  assert.match(checkoutFunction, /quantity > tier\.max_per_order/);
  assert.match(fulfilment, /p_quantity > least\(v_tier\.max_per_order, 20\)/);
});

test("the buyer receives and retains every generated pass", () => {
  assert.match(email, /t\.tickets\.map\(\(ticket, i\)/);
  assert.match(email, /passes: t\.tickets\.map/);
  assert.match(orderEmail, /tickets\.length === 0/);
  assert.match(orderEmail, /tickets,/);
  assert.match(ticketsView, /order\.tickets\.map/);
  assert.match(ticketsView, /qr\[ticket\.token\]/);
  assert.match(ticketsView, /total <= 10/);
  assert.match(ticketsView, /total > 10/);
});

test("one buyer email renders every pass while a guest email renders only one", () => {
  const passes = Array.from({ length: 8 }, (_, index) => ({
    guest_number: index + 1,
    token: String(index + 1).repeat(36).slice(0, 36),
    qrSrc: `cid:pass-${index + 1}`,
  }));
  const owner = renderPassEmail({
    name: "Vinay Kumar",
    eventName: "Diwali Night",
    dateLabel: "November 7, 2026",
    timeLabel: "9:00 PM – 2:00 AM",
    venueName: "The Nichols Venue",
    venueAddress: "2515 Morse St",
    tierName: "Group of 8",
    sealUrl: "https://example.com/seal.png",
    ticketsUrl: "https://example.com/tickets?o=owner",
    passes,
  });
  for (let i = 1; i <= 8; i++) assert.match(owner.html, new RegExp(`cid:pass-${i}`));
  assert.match(owner.text, /8 guests/);

  const guest = renderGuestPassEmail({
    senderName: "Vinay",
    eventName: "Diwali Night",
    dateLabel: "November 7, 2026",
    timeLabel: "9:00 PM – 2:00 AM",
    venueName: "The Nichols Venue",
    tierName: "Group of 8",
    guestNumber: 4,
    total: 8,
    reference: "ABC123",
    passUrl: "https://example.com/tickets/shared#secret",
    sealUrl: "https://example.com/seal.png",
    qrSrc: "cid:guest-pass",
  });
  assert.match(guest.html, /cid:guest-pass/);
  assert.match(guest.html, /04 \/ 08/);
  assert.doesNotMatch(guest.html, /pass-1|pass-2|pass-3/);
});

test("maximum currently selectable admissions are explicit", () => {
  const maximums = Object.fromEntries(
    publicTiers.map((tier) => [tier.name, (tier.admits ?? 1) * Math.min(tier.maxPerOrder ?? 10, 10)]),
  );
  assert.deepEqual(maximums, {
    "Early Bird": 10,
    Female: 10,
    Male: 10,
    Couple: 20,
    "Group of 5": 50,
    "Group of 8": 80,
  });
});

test("guest names accept real-world punctuation and reject unsafe input", () => {
  assert.equal(cleanGuestName("  PRIYA   SHAH  "), "Priya Shah");
  assert.equal(cleanGuestName("o’connor-smith"), "O’Connor-Smith");
  assert.equal(cleanGuestName("Jose\u0301 Alvarez"), "José Alvarez");
  assert.equal(cleanGuestName("McKay"), "McKay");
  assert.equal(cleanGuestName("<script>alert(1)</script>"), null);
  assert.equal(cleanGuestName("A"), null);
  assert.equal(cleanGuestName("A".repeat(61)), null);
});
