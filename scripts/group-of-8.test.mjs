// GROUP OF 8: one unit is $139.99, admits eight, and becomes eight individual QR passes.
// The SQL runs against the real migrations in an in-memory Postgres (PGlite).
import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVENT, GISO15_ID, openDatabase, seedTiers } from "./pg-harness.mjs";
import { events } from "../src/data/events.ts";
import { canIncrease, cartAdmissions, clampQuantities, MAX_CART_ADMISSIONS } from "../src/lib/cart.ts";
import { buildCartSnapshot, parseCartItems, priceCart, promoHasNoEligibleLine, NON_PUBLIC_TIER_IDS } from "../supabase/functions/_shared/cart.mjs";
import { promoEligibilityMessage, promotionAppliesToTier } from "../supabase/functions/_shared/promo.mjs";
import { renderPassEmail } from "../supabase/functions/_shared/pass-email.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ACTOR = "22222222-2222-4222-8222-222222222222";
const GISO15 = { id: GISO15_ID, code: "GISO15", percent: 15, eligibleTierIds: ["female", "general"] };

const event = events.find((row) => row.slug === "diwali-night");
const tiers = event.ticketTiers;
const group8 = tiers.find((tier) => tier.id === "group-8");

let db;
before(async () => {
  db = await openDatabase();
  await db.query("insert into auth.users (id, email) values ($1, 'ops8@example.com')", [ACTOR]);
}, { timeout: 120000 });

beforeEach(async () => {
  await db.exec(`
    truncate orders, checkout_holds, checkout_carts, payment_flags, tiers cascade;
    delete from scans;
  `);
  await seedTiers(db);
});

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const sold = async (tier) => Number((await one("select tier_sold($1, $2) as n", [EVENT, tier])).n);
const tickets = (orderId) => rows("select tier_id, guest_number, status, token from tickets where order_id = $1 order by guest_number", [orderId]);
const fakeTax = (cents) => Math.round(cents * 0.0825);
let seq = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const nextPi = () => `pi_g8_${String(++seq).padStart(6, "0")}`;

async function linesFor(items) {
  const dbTiers = await rows("select * from tiers where event_id = $1", [EVENT]);
  return items.map((item) => {
    const tier = dbTiers.find((t) => t.tier_id === item.tierId);
    return { tierId: item.tierId, name: tier.name, unitCents: tier.price_cents, quantity: item.quantity, admits: tier.admits };
  });
}

async function snapshotFor(items, promo = null) {
  const priced = priceCart(await linesFor(items), promo);
  return { priced, snapshot: buildCartSnapshot({ priced, tax: fakeTax(priced.discountedSubtotal), currency: "usd", promo }) };
}

async function reserve(items, promo = null) {
  const { snapshot } = await snapshotFor(items, promo);
  try {
    const result = await one("select * from reserve_cart($1, $2::jsonb, $3, $4::jsonb, $5, $6)", [
      EVENT,
      JSON.stringify(items.map((i) => ({ tier_id: i.tierId, quantity: i.quantity }))),
      nextKey(),
      JSON.stringify(snapshot),
      "usd",
      snapshot.total,
    ]);
    return { ok: true, snapshot, ...result };
  } catch (err) {
    return { ok: false, error: String(err.message), snapshot };
  }
}

async function buy(items, promo = null) {
  const res = await reserve(items, promo);
  assert.ok(res.ok, res.error);
  const pi = nextPi();
  await db.query("update checkout_carts set payment_intent_id = $1 where id = $2", [pi, res.cart_id]);
  await db.query("update checkout_holds set payment_intent_id = $1 where id = $2", [pi, res.hold_id]);
  const out = await one("select * from create_cart_order($1, $2, $3::uuid, $4, $5, $6, $7)", [pi, pi, res.cart_id, "Test Buyer", "buyer@example.com", res.snapshot.total, "usd"]);
  return { res, pi, ...out };
}

async function cash(items, promo = null) {
  const { snapshot } = await snapshotFor(items, promo);
  const result = await one("select * from create_cash_order($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8)", [
    EVENT,
    JSON.stringify(items.map((i) => ({ tier_id: i.tierId, quantity: i.quantity }))),
    JSON.stringify(snapshot),
    "Cash Buyer",
    "cash@example.com",
    "",
    `g8-cash-key-${String(++seq).padStart(12, "0")}`,
    ACTOR,
  ]);
  return { ...result, snapshot };
}

test("Group of 8 is a public paid tier: $139.99, admits 8, alongside the other paid options", () => {
  assert.ok(group8, "group-8 is in the public ticket data");
  assert.equal(group8.name, "Group of 8");
  assert.equal(group8.priceCents, 13999);
  assert.equal(group8.admits, 8);
  assert.ok(!group8.hidden && !group8.priceOnRequest && !group8.soldOut);
  assert.deepEqual(
    tiers.filter((t) => !t.hidden).map((t) => [t.id, t.admits ?? 1]),
    [["early-bird", 1], ["female", 1], ["general", 1], ["couple", 2], ["group", 5], ["group-8", 8]],
  );
  assert.ok(!NON_PUBLIC_TIER_IDS.includes("group-8"));
  assert.equal(tiers.some((t) => /vip|complimentary/i.test(`${t.id} ${t.name}`)), false, "private passes stay out of the public list");
});

test("the browser lets a booking hold two Group of 8 (16 admissions) and stops the third", () => {
  const cartTiers = tiers.filter((t) => t.id !== "early-bird");
  assert.equal(MAX_CART_ADMISSIONS, 20);
  assert.equal(canIncrease(cartTiers, {}, group8), true);
  assert.equal(canIncrease(cartTiers, { "group-8": 1 }, group8), true);
  assert.equal(canIncrease(cartTiers, { "group-8": 2 }, group8), false, "24 admissions is over the cap");
  assert.equal(cartAdmissions(cartTiers, { "group-8": 2 }), 16);
  assert.deepEqual(clampQuantities(cartTiers, { "group-8": 3 }), { "group-8": 2 });
});

test("the server prices Group of 8 from the tier row and counts 8 admissions per unit", async () => {
  const { priced } = await snapshotFor([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(priced.originalSubtotal, 13999);
  assert.equal(priced.totalAdmissions, 8);
  assert.equal(priced.totalUnits, 1);
  assert.equal(priced.lines[0].admissionsPerUnit, 8);
  const two = await snapshotFor([{ tierId: "group-8", quantity: 2 }]);
  assert.equal(two.priced.originalSubtotal, 27998);
  assert.equal(two.priced.totalAdmissions, 16);
});

test("the cart request carries only an id and a quantity", () => {
  const parsed = parseCartItems([{ ticket_type: "group-8", quantity: 1 }]);
  assert.deepEqual(parsed.items, [{ tierId: "group-8", quantity: 1 }]);
  const lax = parseCartItems([{ ticket_type: "group-8", quantity: 1, price: 1, admits: 1, unitCents: 1 }]);
  assert.deepEqual(lax.items, [{ tierId: "group-8", quantity: 1 }], "client price and admissions are ignored");
});

test("GISO15 never applies to Group of 8; it discounts Female and Male lines only", async () => {
  assert.equal(promotionAppliesToTier({ eligible_tier_ids: ["female", "general"] }, "group-8"), false);
  assert.equal(promoHasNoEligibleLine([{ tierId: "group-8" }], GISO15.eligibleTierIds), true);
  assert.equal(promoEligibilityMessage("GISO15", ["Female", "Male"]), "GISO15 is valid for Female and Male tickets only.");

  const alone = await snapshotFor([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(alone.priced.discount, 0);

  const female = await snapshotFor([{ tierId: "female", quantity: 1 }, { tierId: "group-8", quantity: 1 }], GISO15);
  assert.equal(female.priced.discount, 270, "15% of Female $17.99, rounded half up");
  assert.deepEqual(female.priced.lines.map((l) => [l.tierId, l.discountCents]), [["female", 270], ["group-8", 0]]);
  assert.equal(female.priced.discountedSubtotal, 1799 + 13999 - 270);

  const male = await snapshotFor([{ tierId: "general", quantity: 1 }, { tierId: "group-8", quantity: 1 }], GISO15);
  assert.equal(male.priced.discount, 300);
  assert.deepEqual(male.priced.lines.map((l) => [l.tierId, l.discountCents]), [["general", 300], ["group-8", 0]]);

  const couple = await snapshotFor([{ tierId: "couple", quantity: 1 }, { tierId: "group-8", quantity: 1 }], GISO15);
  assert.equal(couple.priced.discount, 0);
});

test("Group of 8 × 1 creates one order, one item, and 8 individual passes with unique QR tokens", async () => {
  const out = await buy([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(out.outcome, "created");
  assert.equal((await rows("select id from orders")).length, 1);
  const item = await one("select * from order_items where order_id = $1", [out.order_id]);
  assert.deepEqual(
    [item.tier_id, item.display_name_snapshot, item.unit_price_cents, item.quantity, item.admissions_per_unit, item.total_admissions],
    ["group-8", "Group of 8", 13999, 1, 8, 8],
  );
  const passes = await tickets(out.order_id);
  assert.equal(passes.length, 8);
  assert.deepEqual(passes.map((p) => p.guest_number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(passes.every((p) => p.tier_id === "group-8" && p.status === "valid"));
  assert.equal(new Set(passes.map((p) => p.token)).size, 8, "every pass has its own QR token");
  assert.equal(await sold("group-8"), 1, "one unit sold, not eight");
});

test("Group of 8 × 2 issues 16 passes and consumes two inventory units; × 3 is refused", async () => {
  const two = await buy([{ tierId: "group-8", quantity: 2 }]);
  assert.equal((await tickets(two.order_id)).length, 16);
  assert.equal(await sold("group-8"), 2);

  const three = await reserve([{ tierId: "group-8", quantity: 3 }]);
  assert.equal(three.ok, false);
  assert.match(three.error, /too_many_admissions/);
  assert.equal(await sold("group-8"), 2);
  assert.equal((await rows("select 1 from checkout_holds")).length, 0, "a refused cart holds nothing");
});

test("Group of 8 mixes with Female, Male and Couple inside the 20-admission cap", async () => {
  for (const other of ["female", "general", "couple"]) {
    const admits = other === "couple" ? 2 : 1;
    const out = await buy([{ tierId: other, quantity: 1 }, { tierId: "group-8", quantity: 1 }]);
    assert.equal((await tickets(out.order_id)).length, admits + 8, other);
    assert.equal((await rows("select 1 from order_items where order_id = $1", [out.order_id])).length, 2);
  }
  const over = await reserve([{ tierId: "group-8", quantity: 2 }, { tierId: "couple", quantity: 2 }, { tierId: "female", quantity: 1 }]);
  assert.equal(over.ok, false, "21 admissions");
  assert.match(over.error, /too_many_admissions/);
  const exactly = await reserve([{ tierId: "group-8", quantity: 2 }, { tierId: "couple", quantity: 2 }]);
  assert.ok(exactly.ok, exactly.error);
});

test("a mixed Female + Group of 8 order with GISO15 stores the partial discount", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }, { tierId: "group-8", quantity: 1 }], GISO15);
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.promo_code, "GISO15");
  assert.equal(order.original_subtotal_cents, 1799 + 13999);
  assert.equal(order.discount_amount_cents, 270);
  const items = await rows("select tier_id, promo_eligible, eligible_discount_cents from order_items where order_id = $1 order by position", [out.order_id]);
  assert.deepEqual(items.map((i) => [i.tier_id, i.promo_eligible, Number(i.eligible_discount_cents)]), [["female", true, 270], ["group-8", false, 0]]);
});

test("the single-ticket path also issues 8 passes for one unit, and a replay adds nothing", async () => {
  const run = () => db.query(
    "select create_order_with_tickets('cs_g8_single', 'pi_g8_single', $1, 'group-8', 'Group of 8', 1, 8, 'Single Buyer', 'single@example.com', 15154, 'usd')",
    [EVENT],
  );
  await run();
  await run();
  const orders = await rows("select * from orders where stripe_payment_intent = 'pi_g8_single'");
  assert.equal(orders.length, 1);
  assert.equal(orders[0].quantity, 1);
  assert.equal((await tickets(orders[0].id)).length, 8);
  assert.equal(await sold("group-8"), 1);
});

test("a full refund cancels all 8 passes, restores one inventory unit, and is idempotent", async () => {
  const out = await buy([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(await sold("group-8"), 1);
  assert.equal((await one("select cancel_order_by_payment_intent($1, true) as n", [out.pi])).n, 8);
  assert.equal((await one("select status from orders where id = $1", [out.order_id])).status, "refunded");
  assert.equal((await tickets(out.order_id)).filter((t) => t.status === "valid").length, 0);
  assert.equal((await rows("select 1 from order_items where order_id = $1", [out.order_id])).length, 1, "the item snapshot survives");
  assert.equal(await sold("group-8"), 0);
  assert.equal((await one("select cancel_order_by_payment_intent($1, true) as n", [out.pi])).n, 0);
  assert.equal(await sold("group-8"), 0);
});

test("a partial refund leaves Group of 8 passes and inventory alone", async () => {
  const out = await buy([{ tierId: "group-8", quantity: 1 }]);
  await db.query("select cancel_order_by_payment_intent($1, false)", [out.pi]);
  assert.equal((await tickets(out.order_id)).filter((t) => t.status === "valid").length, 8);
  assert.equal(await sold("group-8"), 1);
});

test("each of the 8 passes scans on its own: admitted once, then already used", async () => {
  const out = await buy([{ tierId: "group-8", quantity: 1 }]);
  const passes = await tickets(out.order_id);
  // Guests arrive separately and in any order.
  for (const index of [5, 0, 7, 2, 1, 6, 3, 4]) {
    const first = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[index].token, EVENT]);
    assert.equal(first.outcome, "admitted", `pass ${index + 1}`);
    assert.equal(first.tier_name, "Group of 8");
    const again = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[index].token, EVENT]);
    assert.equal(again.outcome, "already-used");
  }
  assert.equal((await rows("select 1 from tickets where order_id = $1 and status = 'checked-in'", [out.order_id])).length, 8);
});

test("a cash sale of Group of 8 is $139.99, issues 8 passes, takes one unit, and uses no Stripe payment", async () => {
  const out = await cash([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(out.outcome, "created");
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.payment_method, "cash");
  assert.equal(order.stripe_payment_intent ?? null, null, "no Stripe payment");
  assert.equal(order.original_subtotal_cents, 13999);
  assert.equal(order.discount_amount_cents, 0);
  const passes = await tickets(out.order_id);
  assert.equal(passes.length, 8);
  assert.equal(new Set(passes.map((p) => p.token)).size, 8);
  assert.equal(await sold("group-8"), 1);
});

test("a cash sale of Female + Group of 8 with GISO15 discounts Female only", async () => {
  const out = await cash([{ tierId: "female", quantity: 1 }, { tierId: "group-8", quantity: 1 }], GISO15);
  assert.equal(out.outcome, "created");
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.discount_amount_cents, 270);
  assert.equal(order.original_subtotal_cents, 1799 + 13999);
  const items = await rows("select tier_id, promo_eligible, eligible_discount_cents from order_items where order_id = $1 order by position", [out.order_id]);
  assert.deepEqual(items.map((i) => [i.tier_id, i.promo_eligible, Number(i.eligible_discount_cents)]), [["female", true, 270], ["group-8", false, 0]]);
  assert.equal((await tickets(out.order_id)).length, 9);
});

test("the buyer email says Group of 8 · 8 admissions and carries all 8 passes", () => {
  const passes = Array.from({ length: 8 }, (_, index) => ({ guest_number: index + 1, token: String(index + 1).repeat(36).slice(0, 36), qrSrc: `cid:g8-${index + 1}` }));
  const base = {
    name: "Vinay Kumar",
    to: "buyer@example.com",
    eventName: "Diwali Night",
    dateLabel: "November 7, 2026",
    timeLabel: "9:00 PM – 2:00 AM",
    venueName: "The Nichols Venue",
    venueAddress: "2515 Morse St",
    sealUrl: "https://example.com/seal.png",
    ticketsUrl: "https://example.com/tickets?o=owner",
  };
  const single = renderPassEmail({ ...base, tierName: "Group of 8", passes });
  assert.match(single.html, /Group of 8 &middot; 8 admissions/);
  assert.doesNotMatch(single.html, /Admit one/);
  for (let i = 1; i <= 8; i++) assert.match(single.html, new RegExp(`cid:g8-${i}`));
  assert.match(single.text, /Group of 8 · 8 admissions/);
  assert.match(single.html, /08 \/ 08/);

  const mixed = renderPassEmail({
    ...base,
    tierName: "Mixed",
    passes: [{ guest_number: 1, token: "a".repeat(36), qrSrc: "cid:f-1" }, ...passes.map((p) => ({ ...p, guest_number: p.guest_number + 1 }))],
    groups: [
      { tierName: "Female", passes: [{ guest_number: 1, token: "a".repeat(36), qrSrc: "cid:f-1" }] },
      { tierName: "Group of 8", passes: passes.map((p) => ({ ...p, guest_number: p.guest_number + 1 })) },
    ],
  });
  assert.match(mixed.html, /Group of 8/);
  assert.match(mixed.html, />8 admissions</);
  assert.match(mixed.text, /Group of 8 — 8 admissions/);

  const female = renderPassEmail({ ...base, tierName: "Female", passes: [passes[0]] });
  assert.match(female.html, /Admit one/, "a single pass keeps its original header");
});

test("the single-ticket checkout path caps admissions, not just units", () => {
  const checkout = read("supabase/functions/checkout/index.ts");
  assert.match(checkout, /quantity \* Math\.max\(Number\(tier\.admits\) \|\| 1, 1\) > MAX_CART_ADMISSIONS/);
  const gate = checkout.indexOf("quantity > tier.max_per_order");
  const cap = checkout.indexOf("> MAX_CART_ADMISSIONS", gate);
  const tax = checkout.indexOf("priceTickets(", gate);
  assert.ok(gate > 0 && cap > gate && cap < tax, "the cap runs before any price, tax or payment is created");
});

test("admin order detail reports units, admissions per unit and total admissions", () => {
  const panel = read("src/components/admin/OrdersPanel.tsx");
  assert.match(panel, /order\.units\} units · \{order\.admissions\} admissions/);
  assert.match(panel, /line\.admissions/);
});

test("the activation migration touches only the existing Group of 8 row, and only when it still matches", () => {
  const sql = read("supabase/migrations/20261110000000_activate_group_of_8.sql");
  assert.match(sql, /update public\.tiers/);
  assert.match(sql, /tier_id = 'group-8'/);
  assert.match(sql, /price_cents = 13999/);
  assert.match(sql, /admits = 8/);
  assert.doesNotMatch(sql, /insert into|delete from|drop |alter table/i);
});

test("the activation migration is idempotent and leaves a changed row alone", async () => {
  const sql = read("supabase/migrations/20261110000000_activate_group_of_8.sql");
  await db.query("update tiers set active = false where tier_id = 'group-8'");
  await db.exec(sql);
  assert.equal((await one("select active from tiers where tier_id = 'group-8'")).active, true);
  await db.exec(sql);
  assert.equal((await one("select active from tiers where tier_id = 'group-8'")).active, true);
  await db.query("update tiers set active = false, price_cents = 12999 where tier_id = 'group-8'");
  await db.exec(sql);
  assert.equal((await one("select active from tiers where tier_id = 'group-8'")).active, false, "a repriced row is not activated");
  assert.equal((await rows("select 1 from tiers where tier_id = 'group-8'")).length, 1, "no duplicate tier");
});
