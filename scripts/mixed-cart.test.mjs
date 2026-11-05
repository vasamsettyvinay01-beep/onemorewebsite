// Mixed-ticket cart: pricing, validation, tamper detection, the browser cart helpers,
// the grouped pass email, and the wiring that keeps the single-ticket path and every
// non-public ticket type out of reach. Database behaviour is in mixed-cart-db.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_CART_ADMISSIONS,
  allocateCents,
  buildCartSnapshot,
  cartMetaSummary,
  cartSummaryLabel,
  lineAdmissions,
  parseCartItems,
  priceCart,
  promoHasNoEligibleLine,
  verifyCartSnapshot,
  withLineTax,
} from "../supabase/functions/_shared/cart.mjs";
import {
  canDecrease,
  canIncrease,
  cartAdmissions,
  cartItems,
  cartKey,
  cartSelections,
  clampQuantities,
  normaliseLines,
  promoScopeLabel,
  requestBody,
} from "../src/lib/cart.ts";
import { renderPassEmail } from "../supabase/functions/_shared/pass-email.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const FEMALE = { tierId: "female", name: "Female", unitCents: 1799, admits: 1 };
const MALE = { tierId: "general", name: "Male", unitCents: 1999, admits: 1 };
const COUPLE = { tierId: "couple", name: "Couple", unitCents: 2999, admits: 2 };
const GROUP5 = { tierId: "group5", name: "Group of 5", unitCents: 6999, admits: 5 };
const GISO15 = { percent: 15, eligibleTierIds: ["female", "general"] };
const line = (tier, quantity) => ({ ...tier, quantity });

// ── Request validation ───────────────────────────────────────────────────────

test("a cart is read from ticket ids and quantities only", () => {
  const parsed = parseCartItems([
    { ticket_type: "female", quantity: 1, price: 1, unitCents: 1, discount: 99, admits: 50, name: "Free" },
    { ticket_type: "couple", quantity: 2 },
  ]);
  assert.deepEqual(parsed, { items: [{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 2 }] });
});

test("malformed carts are rejected", () => {
  const bad = (value) => assert.ok("error" in parseCartItems(value), JSON.stringify(value));
  bad(undefined);
  bad(null);
  bad("female");
  bad({});
  bad([]);
  bad([null]);
  bad([[]]);
  bad([{ ticket_type: "female" }]);
  bad([{ quantity: 1 }]);
  bad([{ ticket_type: "female", quantity: 0 }]);
  bad([{ ticket_type: "female", quantity: -1 }]);
  bad([{ ticket_type: "female", quantity: 1.5 }]);
  bad([{ ticket_type: "female", quantity: "2" }]);
  bad([{ ticket_type: "female", quantity: Number.NaN }]);
  bad([{ ticket_type: "female", quantity: Infinity }]);
  bad([{ ticket_type: "female", quantity: MAX_CART_ADMISSIONS + 1 }]);
  bad([{ ticket_type: "bad id!", quantity: 1 }]);
  bad([{ ticket_type: { $ne: "x" }, quantity: 1 }]);
  bad(Array.from({ length: 9 }, (_, i) => ({ ticket_type: `t${i}`, quantity: 1 })));
});

test("duplicate ticket types are rejected, not merged", () => {
  assert.deepEqual(
    parseCartItems([
      { ticket_type: "female", quantity: 1 },
      { ticket_type: "female", quantity: 2 },
    ]),
    { error: "duplicate_item" },
  );
});

test("VIP, complimentary and the mixed marker can never be bought", () => {
  for (const id of ["vip", "VIP", "complimentary", "Complimentary", "mixed"]) {
    assert.deepEqual(parseCartItems([{ ticket_type: "female", quantity: 1 }, { ticket_type: id, quantity: 1 }]), { error: "not_public" }, id);
  }
});

// ── Pricing and promo ────────────────────────────────────────────────────────

test("admissions follow the ticket, not the line quantity", () => {
  assert.equal(lineAdmissions(2, 1), 2);
  assert.equal(lineAdmissions(1, 2), 2);
  assert.equal(lineAdmissions(1, 5), 5);
  assert.equal(lineAdmissions(3, undefined), 3);
  const cart = priceCart([line(FEMALE, 2), line(COUPLE, 1), line(GROUP5, 1)]);
  assert.equal(cart.totalAdmissions, 2 + 2 + 5);
  assert.equal(cart.totalUnits, 4);
});

test("GISO15 on Female x1, Male x2, Couple x1 discounts only Female and Male", () => {
  const cart = priceCart([line(FEMALE, 1), line(MALE, 2), line(COUPLE, 1)], GISO15);
  assert.equal(cart.originalSubtotal, 1799 + 3998 + 2999);
  assert.equal(cart.eligibleSubtotal, 1799 + 3998);
  const [female, male, couple] = cart.lines;
  assert.equal(female.discountCents, 270); // 15% of $17.99 = $2.6985, half-up
  assert.equal(female.promoEligible, true);
  assert.equal(male.discountCents, 600); // 15% of $39.98 = $5.997
  assert.equal(couple.discountCents, 0);
  assert.equal(couple.promoEligible, false);
  assert.equal(couple.discountedLineCents, 2999);
  assert.equal(cart.discount, 270 + 600);
  assert.equal(cart.discountedSubtotal, cart.originalSubtotal - cart.discount);
});

test("GISO15 on Female x1 and Couple x1 discounts only the Female line", () => {
  const cart = priceCart([line(FEMALE, 1), line(COUPLE, 1)], GISO15);
  assert.equal(cart.discount, 270);
  assert.equal(cart.lines[1].discountedLineCents, 2999);
  assert.equal(cart.discountedSubtotal, 1799 - 270 + 2999);
});

test("a promo with no eligible line is detected so the server can refuse it", () => {
  assert.equal(promoHasNoEligibleLine([COUPLE], GISO15.eligibleTierIds), true);
  assert.equal(promoHasNoEligibleLine([GROUP5], GISO15.eligibleTierIds), true);
  assert.equal(promoHasNoEligibleLine([COUPLE, GROUP5], GISO15.eligibleTierIds), true);
  assert.equal(promoHasNoEligibleLine([COUPLE, FEMALE], GISO15.eligibleTierIds), false);
});

test("changing the cart re-prices the promo: Female -> Couple removes the discount, adding Male discounts both", () => {
  const femaleOnly = priceCart([line(FEMALE, 1)], GISO15);
  assert.equal(femaleOnly.discount, 270);
  assert.equal(promoHasNoEligibleLine([COUPLE], GISO15.eligibleTierIds), true);
  const coupleOnly = priceCart([line(COUPLE, 1)], null);
  assert.equal(coupleOnly.discount, 0);
  assert.equal(coupleOnly.discountedSubtotal, 2999);
  const both = priceCart([line(FEMALE, 1), line(MALE, 1)], GISO15);
  assert.equal(both.discount, 270 + 300);
});

test("without a code nothing is discounted", () => {
  const cart = priceCart([line(FEMALE, 3), line(COUPLE, 1)]);
  assert.equal(cart.discount, 0);
  assert.equal(cart.discountedSubtotal, cart.originalSubtotal);
  assert.ok(cart.lines.every((entry) => !entry.promoEligible));
});

test("tax is shared across lines without gaining or losing a cent", () => {
  for (const tax of [0, 1, 7, 99, 612, 1234]) {
    const parts = allocateCents(tax, [1529, 3398, 2999]);
    assert.equal(parts.reduce((a, b) => a + b, 0), tax);
    assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0));
  }
  const priced = priceCart([line(FEMALE, 1), line(MALE, 2), line(COUPLE, 1)], GISO15);
  const taxed = withLineTax(priced, 640);
  assert.equal(taxed.reduce((sum, entry) => sum + entry.taxCents, 0), 640);
  assert.equal(taxed.reduce((sum, entry) => sum + entry.lineTotalCents, 0), priced.discountedSubtotal + 640);
});

test("cart labels are short and readable", () => {
  const lines = priceCart([line(FEMALE, 1), line(MALE, 2), line(COUPLE, 1)]).lines;
  assert.equal(cartMetaSummary(lines), "female:1,general:2,couple:1");
  assert.equal(cartSummaryLabel(lines), "Female × 1, Male × 2, Couple × 1");
});

// ── The frozen snapshot the webhook trusts ───────────────────────────────────

function snapshotFor(lines, promo, tax = 500) {
  const priced = priceCart(lines, promo);
  return buildCartSnapshot({
    priced,
    tax,
    currency: "USD",
    promo: promo ? { id: "00000000-0000-0000-0000-000000000001", code: "GISO15", percent: promo.percent, eligibleTierIds: promo.eligibleTierIds } : null,
  });
}

test("an untouched snapshot verifies, with or without a promo", () => {
  assert.equal(verifyCartSnapshot(snapshotFor([line(FEMALE, 1), line(MALE, 2), line(COUPLE, 1)], GISO15)), null);
  assert.equal(verifyCartSnapshot(snapshotFor([line(COUPLE, 1), line(GROUP5, 1)], null)), null);
  assert.equal(verifyCartSnapshot(snapshotFor([line(FEMALE, 1)], null, 0)), null);
});

test("a tampered snapshot is refused", () => {
  const good = () => structuredClone(snapshotFor([line(FEMALE, 1), line(COUPLE, 1)], GISO15));
  const cases = {
    "cheaper unit price": (s) => { s.lines[1].unitCents = 1; },
    "free quantity": (s) => { s.lines[0].quantity = 5; },
    "bigger discount": (s) => { s.discount += 100; s.discountedSubtotal -= 100; s.total -= 100; },
    "discount on an ineligible line": (s) => { s.lines[1].promoEligible = true; s.lines[1].discountCents = 450; },
    "wrong total": (s) => { s.total -= 1; },
    "negative tax": (s) => { s.tax = -5; },
    "hidden admissions": (s) => { s.totalAdmissions -= 1; },
    "extra admissions per unit": (s) => { s.lines[1].admissionsPerUnit = 9; s.lines[1].totalAdmissions = 9; },
    "duplicate line": (s) => { s.lines.push({ ...s.lines[0] }); },
    "non-public ticket": (s) => { s.lines[0].tierId = "vip"; },
    "no lines": (s) => { s.lines = []; },
    "over the admission limit": (s) => { s.lines[1].quantity = 20; s.lines[1].totalAdmissions = 40; s.totalAdmissions = 41; },
  };
  for (const [name, tamper] of Object.entries(cases)) {
    const snapshot = good();
    tamper(snapshot);
    assert.notEqual(verifyCartSnapshot(snapshot), null, name);
  }
  assert.notEqual(verifyCartSnapshot(null), null);
  assert.notEqual(verifyCartSnapshot("nope"), null);
});

// ── Browser cart helpers ─────────────────────────────────────────────────────

const TIERS = [
  { id: "female", admits: 1, maxPerOrder: 10 },
  { id: "general", admits: 1, maxPerOrder: 10 },
  { id: "couple", admits: 2, maxPerOrder: 10 },
  { id: "group5", admits: 5, maxPerOrder: 4 },
];

test("the browser counts real admissions and starts empty", () => {
  assert.deepEqual(cartItems(TIERS, {}), []);
  assert.equal(cartAdmissions(TIERS, {}), 0);
  const q = { female: 1, general: 2, couple: 1 };
  assert.deepEqual(cartItems(TIERS, q), [
    { ticket_type: "female", quantity: 1 },
    { ticket_type: "general", quantity: 2 },
    { ticket_type: "couple", quantity: 1 },
  ]);
  assert.equal(cartAdmissions(TIERS, q), 1 + 2 + 2);
  assert.equal(cartSelections(TIERS, q), 3);
  assert.equal(cartKey(cartItems(TIERS, q)), "female:1,general:2,couple:1");
});

test("steppers stop at the admission limit, counting a Group of 5 as five", () => {
  const full = { group5: 4 };
  assert.equal(cartAdmissions(TIERS, full), 20);
  assert.equal(canIncrease(TIERS, full, TIERS[0]), false);
  assert.equal(canIncrease(TIERS, full, TIERS[3]), false);
  assert.equal(canDecrease(full, TIERS[3]), true);
  const nearly = { group5: 3, couple: 2 }; // 15 + 4 = 19
  assert.equal(canIncrease(TIERS, nearly, TIERS[0]), true);
  assert.equal(canIncrease(TIERS, nearly, TIERS[2]), false); // a Couple would reach 21
  assert.equal(canDecrease({}, TIERS[0]), false);
  assert.equal(canIncrease(TIERS, { general: 10 }, TIERS[1]), false);
});

test("quantities that no longer fit are trimmed, never sent", () => {
  assert.deepEqual(clampQuantities(TIERS, { female: 99, general: -3, gone: 4 }), { female: 10 });
  const trimmed = clampQuantities(TIERS, { group5: 4, female: 5 });
  assert.equal(cartAdmissions(TIERS, trimmed), 20);
  assert.deepEqual(trimmed, { female: 5, group5: 3 });
});

test("one ticket type uses the single-ticket request; two or more use the cart request", () => {
  assert.deepEqual(requestBody("evt", [{ ticket_type: "female", quantity: 2 }], { quote: true }), {
    eventId: "evt",
    tierId: "female",
    quantity: 2,
    quote: true,
  });
  const mixed = requestBody("evt", [{ ticket_type: "female", quantity: 1 }, { ticket_type: "couple", quantity: 1 }], { quote: true });
  assert.deepEqual(mixed, {
    eventId: "evt",
    items: [{ ticket_type: "female", quantity: 1 }, { ticket_type: "couple", quantity: 1 }],
    quote: true,
  });
  assert.doesNotMatch(JSON.stringify(mixed), /price|cents|discount|admits|total|tax/i);
});

test("a one-line quote is rebuilt from the single-ticket response", () => {
  const lines = normaliseLines(
    { subtotal: 3598, discount: 540, discountedSubtotal: 3058 },
    { id: "female", name: "Female", unitCents: 1799, quantity: 2, admits: 1 },
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].lineSubtotal, 3598);
  assert.equal(lines[0].promoEligible, true);
  assert.equal(lines[0].admissions, 2);
  assert.equal(normaliseLines({ subtotal: 1 }, null), null);
  assert.equal(normaliseLines({ lines: [{ ticket_type: "x" }] }, null), null);
  assert.equal(promoScopeLabel(["Female", "Male"]), "FEMALE + MALE");
});

// ── Grouped pass email ───────────────────────────────────────────────────────

const pass = (n, tier) => ({ guest_number: n, token: `${tier}${n}`.padEnd(36, "0"), qrSrc: `cid:pass-${n}` });
const baseEmail = {
  name: "Vinay Kumar",
  eventName: "Diwali Night",
  dateLabel: "November 7, 2026",
  timeLabel: "9:00 PM – 2:00 AM",
  venueName: "The Nichols Venue",
  venueAddress: "2515 Morse St",
  tierName: "Female × 1, Couple × 1",
  sealUrl: "https://example.com/seal.png",
  ticketsUrl: "https://example.com/tickets?o=owner",
};

test("a mixed-ticket email lists every pass under its own ticket type with one receipt", () => {
  const mail = renderPassEmail({
    ...baseEmail,
    passes: [pass(1, "f"), pass(2, "c"), pass(3, "c")],
    groups: [
      { tierName: "Female", passes: [pass(1, "f")] },
      { tierName: "Couple", passes: [pass(2, "c"), pass(3, "c")] },
    ],
    receipt: {
      promo: "GISO15 — 15% OFF FEMALE + MALE",
      originalSubtotal: "$47.98",
      discount: "-$2.70",
      discountLabel: "GISO15 discount",
      tax: "$3.42",
      total: "$48.70",
      totalLabel: "Total paid",
    },
  });
  for (const n of [1, 2, 3]) assert.match(mail.html, new RegExp(`cid:pass-${n}`));
  assert.match(mail.html, /Your passes/);
  assert.match(mail.html, /Female/);
  assert.match(mail.html, /Couple/);
  assert.match(mail.html, /GISO15 discount/);
  assert.match(mail.html, /Total paid/);
  assert.match(mail.html, /15% OFF FEMALE \+ MALE/);
  assert.match(mail.text, /Female — 1 admission/);
  assert.match(mail.text, /Couple — 2 admissions/);
  assert.match(mail.text, /GISO15 discount: -\$2\.70/);
  assert.match(mail.text, /Total paid: \$48\.70/);
});

test("a mixed-ticket email without a code has no discount rows", () => {
  const mail = renderPassEmail({
    ...baseEmail,
    passes: [pass(1, "f"), pass(2, "m")],
    groups: [
      { tierName: "Female", passes: [pass(1, "f")] },
      { tierName: "Male", passes: [pass(2, "m")] },
    ],
    receipt: { originalSubtotal: "$37.98", tax: "$3.00", total: "$40.98", totalLabel: "Total paid" },
  });
  assert.doesNotMatch(mail.html, /discount/i);
  assert.match(mail.html, /Total paid/);
});

test("a single-ticket email keeps its original layout", () => {
  const mail = renderPassEmail({ ...baseEmail, tierName: "Female", passes: [pass(1, "f")] });
  assert.match(mail.html, /Admit one/);
  assert.doesNotMatch(mail.html, /Your passes/);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

const checkout = read("supabase/functions/checkout/index.ts");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const view = read("src/components/checkout/CheckoutView.tsx");
const migration = read("supabase/migrations/20261108000000_mixed_ticket_cart.sql");
const adminFn = read("supabase/functions/admin/index.ts");
const orderEmail = read("supabase/functions/_shared/order-email.ts");

test("the single-ticket request path is still dispatched separately from the cart", () => {
  assert.match(checkout, /if \(body\.items !== undefined\) return handleCart\(req, body\);/);
  const legacy = checkout.slice(0, checkout.indexOf("async function handleCart"));
  assert.match(legacy, /tierId/);
  assert.match(webhook, /if \(meta\.omc_cart_id\) return fulfilCart\(pi, sessionId\);/);
});

test("the cart endpoint takes prices, promo scope, tax and totals from the server only", () => {
  const cart = checkout.slice(checkout.indexOf("async function handleCart"));
  assert.match(cart, /parseCartItems\(body\.items\)/);
  assert.match(cart, /\.eq\("active", true\)/);
  assert.match(cart, /priceCart\(/);
  assert.match(cart, /quoteCartTotal\(/);
  assert.match(cart, /reserve_cart/);
  assert.doesNotMatch(cart, /body\.(price|amount|total|tax|discount|unitCents|subtotal)/);
  assert.match(cart, /admissions > MAX_CART_ADMISSIONS/);
});

test("the webhook refuses carts it cannot reconcile and refunds the payment", () => {
  const fulfil = webhook.slice(webhook.indexOf("async function fulfilCart"));
  assert.match(fulfil, /verifyCartSnapshot\(/);
  assert.match(fulfil, /create_cart_order/);
  assert.match(fulfil, /refundAndStop\(/);
});

test("the cart migration only adds: no table, column or data is dropped", () => {
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+column\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+(public\.)?(orders|tickets|tiers|promotions)\b/i);
});

test("the checkout page sends ids and quantities, never prices", () => {
  assert.match(view, /requestBody\(/);
  assert.doesNotMatch(view, /priceCents:|unitCents:\s*t\./);
  assert.doesNotMatch(view, /body: JSON\.stringify\(\{[^}]*(price|amount|discount|total)/);
});

test("quantity steppers are labelled per ticket and are touch-sized", () => {
  assert.match(view, /Decrease \$\{t\.name\} quantity/);
  assert.match(view, /Increase \$\{t\.name\} quantity/);
  assert.match(view, /className="flex size-11 items-center/);
  assert.match(view, /Sold out/);
});

test("the mobile cart bar and the promo wording follow the brief", () => {
  assert.match(view, /aria-label="Cart summary"/);
  assert.match(view, /lg:hidden/);
  assert.match(view, /selections/);
  assert.match(view, /total \{admissions === 1 \? "admission" : "admissions"\}/);
  assert.match(view, />\s*Continue\s*</);
  assert.match(view, /applied ✓/);
  assert.match(view, /Eligible ticket discount/);
  assert.match(view, /Original subtotal/);
  assert.match(view, /Discounted subtotal/);
  assert.match(view, /Your tickets/);
});

test("the organizer and admin views carry the cart lines", () => {
  assert.match(orderEmail, /order_items\(/);
  assert.match(orderEmail, /cart: isCart/);
  assert.match(adminFn, /loadOrderItems\(/);
  assert.match(adminFn, /orderIdsWithTier\(/);
  assert.match(adminFn, /promoAdmissionCounts\(/);
  assert.match(read("src/components/admin/OrdersPanel.tsx"), /Ticket lines/);
});

test("refunds stay whole-order and are not offered per line", () => {
  assert.doesNotMatch(adminFn, /refund_line|refund_item/);
  assert.doesNotMatch(read("src/components/admin/OrdersPanel.tsx"), /Refund (this )?line/i);
});
