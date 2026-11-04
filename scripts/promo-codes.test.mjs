import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePromoCode,
  parsePromoFilter,
  percentDiscountCents,
  priceTickets,
  PROMO_INVALID,
  promoLabel,
  promotionIsLive,
} from "../supabase/functions/_shared/promo.mjs";
import { permit } from "../supabase/functions/_shared/staff-auth.mjs";
import { isReadAction } from "../supabase/functions/_shared/admin-read.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261104020000_promo_codes.sql");
const checkout = read("../supabase/functions/checkout/index.ts");
const webhook = read("../supabase/functions/stripe-webhook/index.ts");
const pricing = read("../supabase/functions/_shared/pricing.ts");
const adminFn = read("../supabase/functions/admin/index.ts");
const orderEmail = read("../supabase/functions/_shared/order-email.ts");
const passEmail = read("../supabase/functions/_shared/pass-email.ts");
const checkoutView = read("../src/components/checkout/CheckoutView.tsx");
const promoPanel = read("../src/components/admin/PromoPanel.tsx");
const ordersPanel = read("../src/components/admin/OrdersPanel.tsx");
const inventory = read("../supabase/migrations/20261009000000_inventory_and_fulfilment.sql");
const checkIn = read("../supabase/migrations/20261011120000_guest_names.sql");

const GISO15 = {
  id: "8b0f3f8e-0000-4000-8000-000000000001",
  code: "GISO15",
  event_id: "evt_diwali_night",
  discount_type: "percentage",
  discount_value: 15,
  active: true,
  starts_at: null,
  expires_at: null,
};

// SQL in create_order_with_tickets: (v_subtotal * p_discount_percent + 50) / 100 on int.
const sqlDiscount = (subtotal, percent) => Math.trunc((subtotal * percent + 50) / 100);

test("GISO15 is accepted in any case, with surrounding whitespace trimmed", () => {
  assert.equal(normalizePromoCode("GISO15"), "GISO15");
  assert.equal(normalizePromoCode("giso15"), "GISO15");
  assert.equal(normalizePromoCode("Giso15"), "GISO15");
  assert.equal(normalizePromoCode("  giso15 \t"), "GISO15");
  assert.equal(normalizePromoCode(""), "");
  assert.equal(normalizePromoCode("   "), "");
  assert.equal(normalizePromoCode(undefined), "");
});

test("malformed codes never reach the database", () => {
  for (const bad of ["GISO 15", "GISO-15", "G1", "giso15;drop", "%", "A".repeat(33), 15, {}, []]) {
    assert.equal(normalizePromoCode(bad), null, String(bad));
  }
  assert.equal(PROMO_INVALID, "PROMO CODE NOT VALID");
});

test("15% is computed on integer cents for every live tier, matching the SQL rounding", () => {
  const tiers = [
    ["Early Bird", 1499, 225, 1274],
    ["Female", 1799, 270, 1529],
    ["Male / General Admission", 1999, 300, 1699],
    ["Couple", 2999, 450, 2549],
    ["Group of 5", 8999, 1350, 7649],
    ["Group of 8", 13999, 2100, 11899],
  ];
  for (const [name, unit, discount, after] of tiers) {
    const priced = priceTickets({ unitCents: unit, quantity: 1, percent: 15 });
    assert.equal(priced.originalSubtotal, unit, name);
    assert.equal(priced.discount, discount, name);
    assert.equal(priced.discountedSubtotal, after, name);
    assert.equal(sqlDiscount(unit, 15), discount, `${name} SQL`);
  }
});

test("multi-ticket orders discount the whole eligible subtotal once", () => {
  assert.equal(percentDiscountCents(10000, 15), 1500);
  const three = priceTickets({ unitCents: 1999, quantity: 3, percent: 15 });
  assert.deepEqual(three, { originalSubtotal: 5997, discount: 900, discountedSubtotal: 5097 });
  for (let qty = 1; qty <= 10; qty += 1) {
    for (const unit of [1499, 1799, 1999, 2999, 8999, 13999]) {
      const priced = priceTickets({ unitCents: unit, quantity: qty, percent: 15 });
      assert.equal(priced.discount, sqlDiscount(unit * qty, 15));
      assert.ok(Number.isInteger(priced.discountedSubtotal));
      assert.equal(priced.originalSubtotal - priced.discount, priced.discountedSubtotal);
    }
  }
});

test("no promo leaves the price untouched", () => {
  assert.deepEqual(priceTickets({ unitCents: 1999, quantity: 2 }), { originalSubtotal: 3998, discount: 0, discountedSubtotal: 3998 });
  assert.throws(() => percentDiscountCents(1999, 15.5));
  assert.throws(() => percentDiscountCents(1999.5, 15));
  assert.throws(() => percentDiscountCents(1999, 101));
  assert.throws(() => priceTickets({ unitCents: 1999, quantity: 0 }));
});

test("a promotion is live only for its event, while active and in its window", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(promotionIsLive(GISO15, "evt_diwali_night", now), true);
  assert.equal(promotionIsLive(GISO15, "evt_other", now), false);
  assert.equal(promotionIsLive({ ...GISO15, active: false }, "evt_diwali_night", now), false);
  assert.equal(promotionIsLive({ ...GISO15, expires_at: "2026-11-04T11:59:59Z" }, "evt_diwali_night", now), false);
  assert.equal(promotionIsLive({ ...GISO15, starts_at: "2026-11-05T00:00:00Z" }, "evt_diwali_night", now), false);
  assert.equal(promotionIsLive({ ...GISO15, discount_type: "fixed" }, "evt_diwali_night", now), false);
  assert.equal(promotionIsLive({ ...GISO15, discount_value: 0 }, "evt_diwali_night", now), false);
  assert.equal(promotionIsLive(null, "evt_diwali_night", now), false);
});

test("admin promo filter accepts all, none, or a canonical code", () => {
  assert.equal(parsePromoFilter(""), "");
  assert.equal(parsePromoFilter(undefined), "");
  assert.equal(parsePromoFilter("none"), "none");
  assert.equal(parsePromoFilter("giso15"), "GISO15");
  assert.equal(parsePromoFilter("x;y"), null);
  assert.equal(promoLabel("GISO15", 15), "GISO15 — 15% OFF");
  assert.equal(promoLabel(null, null), "");
});

test("checkout trusts only the typed code and prices everything on the server", () => {
  assert.match(checkout, /normalizePromoCode\(body\.promoCode\)/);
  for (const field of ["discount", "discountPercent", "percent", "total", "subtotal", "amount", "tax", "discountedSubtotal"]) {
    assert.doesNotMatch(checkout, new RegExp(`body\\.${field}\\b`), field);
  }
  assert.match(checkout, /\.from\("promotions"\)/);
  assert.match(checkout, /promotionIsLive\(data, eventId\)/);
  assert.match(checkout, /priceTickets\(\{ unitCents: unit, quantity, percent: promo\?\.percent \?\? 0 \}\)/);
  assert.match(checkout, /quoteTicketTotal\(stripe, currency, priced\.discountedSubtotal, tierId\)/);
  assert.match(checkout, /amount: quoted\.total/);
  assert.match(checkout, /discount_amount: priced\.discount/);
  assert.match(checkout, /code: "promo_invalid" \}, 422/);
  assert.match(checkout, /omc_promo_code: promo\?\.code \?\? ""/);
  assert.match(pricing, /amount: lineCents/);
});

test("promo and inventory stay separate: the hold is reserved exactly as before", () => {
  assert.match(checkout, /admin\.rpc\("reserve_passes", \{\s*p_event_id: eventId,\s*p_tier_id: tierId,\s*p_quantity: quantity,\s*p_idempotency_key: idempotencyKey,\s*\}\)/);
  assert.doesNotMatch(migration, /function public\.(reserve_passes|tier_sold|tier_held|event_sales|event_holds)/);
  assert.match(migration, /v_sold \+ p_quantity > v_tier\.capacity/);
});

test("a reused hold cannot carry a different promo or amount", () => {
  assert.match(checkout, /existing\.amount !== expected\.amount/);
  assert.match(checkout, /omc_promo_code \?\? ""\) !== expected\.promoCode/);
});

test("the webhook re-verifies the promo and the discounted amount before tickets", () => {
  assert.match(webhook, /promoFromIntent\(meta\)/);
  assert.match(webhook, /\.from\("promotions"\)/);
  assert.match(webhook, /data\.event_id !== meta\.omc_event_id/);
  assert.match(webhook, /refundAndStop\(paymentIntentId, "promo_mismatch"\)/);
  assert.match(webhook, /amount < priced\.discountedSubtotal/);
  assert.match(webhook, /quoteTicketTotal\(stripe, tier\.currency, priced\.discountedSubtotal, meta\.omc_tier_id\)/);
  assert.match(webhook, /p_promo_code: promo\.code/);
  assert.match(webhook, /stripe_events/);
  assert.match(webhook, /seen\.error\?\.code === "23505"/);
});

test("the order RPC recomputes the discount and stays idempotent", () => {
  assert.match(migration, /create table public\.promotions/);
  assert.match(migration, /'GISO15', 'evt_diwali_night', 'percentage', 15/);
  assert.doesNotMatch(migration, /expires_at\)\s*values|'GISO15'[^;]*now\(\) \+/);
  assert.match(migration, /v_discount := \(v_subtotal \* p_discount_percent \+ 50\) \/ 100/);
  assert.match(migration, /p_amount_total < v_discounted/);
  assert.match(migration, /p_promotion_id uuid default null/);
  assert.match(migration, /p_promo_code text default null/);
  assert.match(migration, /p_discount_percent int default null/);
  assert.equal((migration.match(/return query select v_order_id, 'exists'/g) ?? []).length, 3);
  assert.match(migration, /from generate_series\(1, p_quantity \* v_admits\)/);
  assert.match(migration, /revoke execute on function\s+public\.create_order_with_tickets\(text, text, text, text, text, int, int, text, text, int, text, uuid, text, int\)/);
});

test("the price snapshot is consistent and cannot be rewritten, so refunds keep attribution", () => {
  assert.match(migration, /final_total_cents = discounted_subtotal_cents \+ tax_cents/);
  assert.match(migration, /final_total_cents = amount_total/);
  assert.match(migration, /discounted_subtotal_cents = original_subtotal_cents - discount_amount_cents/);
  assert.match(migration, /raise exception 'order_pricing_immutable'/);
  assert.match(migration, /old\.promo_code is distinct from new\.promo_code/);
  assert.match(migration, /references public\.promotions \(id\) on delete restrict/);
  assert.match(inventory, /update orders\s+set status = case when p_full then 'refunded' else 'partially-refunded' end/);
});

test("tickets and scanning do not depend on the promo", () => {
  assert.doesNotMatch(checkIn, /promo/);
  assert.match(migration, /insert into tickets \(order_id, event_id, tier_id, guest_number, status\)/);
});

test("promo performance is super admin only and reads the order snapshot", () => {
  assert.equal(permit("super_admin", "promo_report"), true);
  assert.equal(permit("admin", "promo_report"), false);
  assert.equal(permit("door_staff", "promo_report"), false);
  assert.equal(isReadAction("promo_report"), true);
  assert.match(adminFn, /case "promo_report"/);
  assert.match(adminFn, /\.eq\("promotion_id", promotion\.id\)/);
  assert.match(adminFn, /summary\.discounts \+= order\.discount_amount_cents/);
  assert.match(adminFn, /order\.status === "refunded"/);
  assert.match(adminFn, /summary\.netRevenue = summary\.grossSales - summary\.refunds - summary\.disputed/);
  assert.match(adminFn, /admissionCounts\(/);
  assert.match(promoPanel, /"promo_report"/);
  assert.match(promoPanel, /Admission tickets via/);
  assert.match(promoPanel, /Orders using/);
});

test("the orders view filters and searches by promo code", () => {
  assert.match(adminFn, /parsePromoFilter\(body\.promo\)/);
  assert.match(adminFn, /request\.is\("promo_code", null\)/);
  assert.match(adminFn, /request\.eq\("promo_code", promo\)/);
  assert.match(adminFn, /promo_code\.ilike/);
  assert.match(ordersPanel, /<option value="none">No promo<\/option>/);
});

test("the customer sees the promo, and only promo orders get a receipt block", () => {
  assert.match(checkoutView, /Promo code<\/label>/);
  assert.match(checkoutView, /placeholder="Enter promo code"/);
  assert.match(checkoutView, /"Apply"/);
  assert.match(checkoutView, />\s*Remove\s*</);
  assert.match(checkoutView, /applied ✓/);
  assert.match(checkoutView, /% off/);
  assert.match(checkoutView, /"PROMO CODE NOT VALID"/);
  assert.doesNotMatch(checkoutView, /percentDiscount|\* 0\.15|\* 15/);
  assert.match(orderEmail, /const receipt = promoted/);
  assert.match(passEmail, /if \(!receipt\) return "";/);
});

test("the promo controls are comfortable touch targets on phones", () => {
  assert.match(checkoutView, /onClick=\{removePromo\}[\s\S]{0,80}className="[^"]*min-h-11/);
  assert.match(checkoutView, /onClick=\{\(\) => void applyPromo\(\)\}[\s\S]{0,120}className="h-10 /);
});
