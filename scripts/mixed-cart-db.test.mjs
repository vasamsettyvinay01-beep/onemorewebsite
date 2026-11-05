// Mixed-ticket cart: SQL behaviour, executed against the real migrations in
// an in-memory Postgres (PGlite). These tests run the money-path functions
// (reserve_cart, create_cart_order, tier_sold, cancel_order_by_payment_intent,
// check_in_ticket) rather than pattern-matching their source.
import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVENT, GISO15_ID, openDatabase, seedTiers } from "./pg-harness.mjs";
import { buildCartSnapshot, priceCart, verifyCartSnapshot } from "../supabase/functions/_shared/cart.mjs";

let db;

before(async () => {
  db = await openDatabase();
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

const GISO15 = { id: GISO15_ID, code: "GISO15", percent: 15, eligibleTierIds: ["female", "general"] };
let seq = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
// Stand-in for Stripe Tax. The SQL never computes tax; it checks the parts add up.
const fakeTax = (cents) => Math.round(cents * 0.0825);

/** Mirrors the checkout function: price from tier rows, build the snapshot, reserve atomically. */
async function reserve(items, { promo = null, key = nextKey(), malformed = false } = {}) {
  const tiers = await rows("select * from tiers where event_id = $1", [EVENT]);
  const lines = items.map((item) => {
    const tier = tiers.find((t) => t.tier_id === item.tierId);
    return { tierId: item.tierId, name: tier?.name ?? item.tierId, unitCents: tier?.price_cents ?? 1, quantity: Math.max(item.quantity, 1), admits: tier?.admits ?? 1 };
  });
  const priced = priceCart(lines, promo);
  const tax = fakeTax(priced.discountedSubtotal);
  const snapshot = buildCartSnapshot({ priced, tax, currency: "usd", promo });
  // Malformed carts are exercised on purpose; their snapshots only need to reach the database.
  if (!malformed) assert.equal(verifyCartSnapshot(snapshot), null);
  try {
    const result = await one("select * from reserve_cart($1, $2::jsonb, $3, $4::jsonb, $5, $6)", [
      EVENT,
      JSON.stringify(items.map((i) => ({ tier_id: i.tierId, quantity: i.quantity }))),
      key,
      JSON.stringify(snapshot),
      "usd",
      snapshot.total,
    ]);
    return { ok: true, key, snapshot, ...result };
  } catch (err) {
    return { ok: false, error: String(err.message), key, snapshot };
  }
}

async function attach(res, pi) {
  await db.query("update checkout_carts set payment_intent_id = $1 where id = $2", [pi, res.cart_id]);
  await db.query("update checkout_holds set payment_intent_id = $1 where id = $2", [pi, res.hold_id]);
}

async function fulfil(res, pi, { amount = res.snapshot.total, email = "buyer@example.com" } = {}) {
  return one("select * from create_cart_order($1, $2, $3::uuid, $4, $5, $6, $7)", [pi, pi, res.cart_id, "Test Buyer", email, amount, "usd"]);
}

let piSeq = 0;
const nextPi = () => `pi_test_${String(++piSeq).padStart(6, "0")}`;

async function buy(items, options = {}) {
  const res = await reserve(items, options);
  assert.ok(res.ok, res.error);
  const pi = nextPi();
  await attach(res, pi);
  const out = await fulfil(res, pi);
  return { res, pi, ...out };
}

const sold = async (tier) => (await one("select tier_sold($1, $2) as n", [EVENT, tier])).n;
const held = async (tier) => (await one("select tier_held($1, $2) as n", [EVENT, tier])).n;
const tickets = (orderId) => rows("select tier_id, guest_number, status from tickets where order_id = $1 order by guest_number", [orderId]);

test("single-ticket compatibility: Female, Male, Couple and Group of 5 each still work", async () => {
  const expected = { female: 1, general: 1, couple: 2, group: 5 };
  for (const [tier, admissions] of Object.entries(expected)) {
    const out = await buy([{ tierId: tier, quantity: 1 }]);
    assert.equal(out.outcome, "created", tier);
    const order = await one("select * from orders where id = $1", [out.order_id]);
    assert.equal(order.tier_id, tier, "a one-line cart keeps the single-ticket order shape");
    assert.equal(order.quantity, 1);
    assert.equal((await tickets(out.order_id)).length, admissions, tier);
    assert.equal(await sold(tier), 1, tier);
  }
});

test("Female × 1 + Male × 2 + Couple × 1 is one order, three items, five passes", async () => {
  const out = await buy([
    { tierId: "female", quantity: 1 },
    { tierId: "general", quantity: 2 },
    { tierId: "couple", quantity: 1 },
  ]);
  assert.equal(out.outcome, "created");
  assert.equal((await rows("select id from orders")).length, 1);
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.tier_id, "mixed");
  assert.equal(order.tier_name, "Female × 1, Male × 2, Couple × 1");
  assert.equal(order.quantity, 4);
  assert.equal(order.amount_total, out.res.snapshot.total);
  assert.equal(order.original_subtotal_cents, 1799 + 2 * 1999 + 2999);
  assert.equal(order.discount_amount_cents, 0);
  assert.equal(order.promo_code, null);
  assert.equal(order.final_total_cents, order.amount_total);

  const items = await rows("select * from order_items where order_id = $1 order by position", [out.order_id]);
  assert.deepEqual(items.map((i) => [i.tier_id, i.display_name_snapshot, i.unit_price_cents, i.quantity, i.admissions_per_unit, i.total_admissions]), [
    ["female", "Female", 1799, 1, 1, 1],
    ["general", "Male", 1999, 2, 1, 2],
    ["couple", "Couple", 2999, 1, 2, 2],
  ]);
  assert.equal(items.reduce((sum, i) => sum + i.line_total_cents, 0), order.amount_total, "line totals add up to the payment");

  const passes = await tickets(out.order_id);
  assert.deepEqual(passes.map((p) => p.tier_id), ["female", "general", "general", "couple", "couple"]);
  assert.deepEqual(passes.map((p) => p.guest_number), [1, 2, 3, 4, 5]);
  assert.ok(passes.every((p) => p.status === "valid"));
  assert.equal(await sold("female"), 1);
  assert.equal(await sold("general"), 2);
  assert.equal(await sold("couple"), 1);
  assert.equal(await sold("group"), 0);
});

test("Female + Male + Group of 5 issues 1 + 1 + 5 = 7 admission passes", async () => {
  const out = await buy([
    { tierId: "female", quantity: 1 },
    { tierId: "general", quantity: 1 },
    { tierId: "group", quantity: 1 },
  ]);
  const passes = await tickets(out.order_id);
  assert.equal(passes.length, 7);
  assert.deepEqual(
    passes.map((p) => p.tier_id),
    ["female", "general", "group", "group", "group", "group", "group"],
  );
  const tokens = await rows("select token from tickets where order_id = $1", [out.order_id]);
  assert.equal(new Set(tokens.map((t) => t.token)).size, 7, "every pass has its own QR token");
  assert.equal(await sold("group"), 1);
});

test("Female + Male + Couple + Group of 5 in one payment", async () => {
  const out = await buy([
    { tierId: "female", quantity: 1 },
    { tierId: "general", quantity: 1 },
    { tierId: "couple", quantity: 1 },
    { tierId: "group", quantity: 1 },
  ]);
  assert.equal((await tickets(out.order_id)).length, 1 + 1 + 2 + 5);
  assert.equal((await rows("select 1 from order_items where order_id = $1", [out.order_id])).length, 4);
});

test("GISO15 on Female + Couple discounts the Female line only", async () => {
  const out = await buy(
    [
      { tierId: "female", quantity: 1 },
      { tierId: "couple", quantity: 1 },
    ],
    { promo: GISO15 },
  );
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.promo_code, "GISO15");
  assert.equal(order.discount_percent, 15);
  assert.equal(order.promotion_id, GISO15_ID);
  assert.equal(order.original_subtotal_cents, 1799 + 2999);
  assert.equal(order.discount_amount_cents, 270);
  assert.equal(order.discounted_subtotal_cents, 1799 + 2999 - 270);
  const items = await rows("select tier_id, promo_eligible, eligible_discount_cents, discounted_line_subtotal_cents from order_items where order_id = $1 order by position", [out.order_id]);
  assert.deepEqual(items, [
    { tier_id: "female", promo_eligible: true, eligible_discount_cents: 270, discounted_line_subtotal_cents: 1529 },
    { tier_id: "couple", promo_eligible: false, eligible_discount_cents: 0, discounted_line_subtotal_cents: 2999 },
  ]);
});

test("GISO15 on Female + Male × 2 + Couple discounts Female and Male lines, never Couple", async () => {
  const out = await buy(
    [
      { tierId: "female", quantity: 1 },
      { tierId: "general", quantity: 2 },
      { tierId: "couple", quantity: 1 },
    ],
    { promo: GISO15 },
  );
  const items = await rows("select tier_id, eligible_discount_cents from order_items where order_id = $1 order by position", [out.order_id]);
  assert.deepEqual(items, [
    { tier_id: "female", eligible_discount_cents: 270 },
    { tier_id: "general", eligible_discount_cents: 600 },
    { tier_id: "couple", eligible_discount_cents: 0 },
  ]);
  assert.equal((await one("select discount_amount_cents d from orders where id = $1", [out.order_id])).d, 870);
});

test("a tampered snapshot that discounts an ineligible line is rejected, and nothing is created", async () => {
  const res = await reserve([{ tierId: "couple", quantity: 1 }], { promo: GISO15 });
  assert.ok(res.ok);
  // Forge: pretend the Couple line was eligible and took 15% off.
  const forged = structuredClone(res.snapshot);
  forged.lines[0].promoEligible = true;
  forged.lines[0].discountCents = 450;
  forged.lines[0].discountedLineCents = 2549;
  await db.query("alter table checkout_carts disable trigger checkout_carts_lock");
  await db.query("update checkout_carts set snapshot = $1::jsonb where id = $2", [JSON.stringify(forged), res.cart_id]);
  await db.query("alter table checkout_carts enable trigger checkout_carts_lock");
  const out = await fulfil(res, nextPi());
  assert.equal(out.outcome, "rejected");
  assert.equal((await rows("select 1 from orders")).length, 0);
  assert.equal((await rows("select 1 from tickets")).length, 0);
  assert.equal((await rows("select 1 from order_items")).length, 0);
});

test("an underpaid or mis-matched payment creates nothing", async () => {
  const res = await reserve([{ tierId: "female", quantity: 1 }]);
  const pi = nextPi();
  await attach(res, pi);
  assert.equal((await fulfil(res, pi, { amount: res.snapshot.total - 1 })).outcome, "underpaid");
  assert.equal((await fulfil(res, pi, { amount: res.snapshot.total + 1 })).outcome, "rejected");
  assert.equal((await rows("select 1 from orders")).length, 0);
  assert.equal(await held("female"), 0, "a rejected payment releases its hold");
});

test("a duplicate fulfilment returns the same order and creates nothing twice", async () => {
  const first = await buy([
    { tierId: "female", quantity: 2 },
    { tierId: "couple", quantity: 1 },
  ]);
  const again = await fulfil(first.res, first.pi);
  assert.equal(again.outcome, "exists");
  assert.equal(again.order_id, first.order_id);
  assert.equal((await rows("select 1 from orders")).length, 1);
  assert.equal((await rows("select 1 from order_items")).length, 2);
  assert.equal((await rows("select 1 from tickets")).length, 4);
  assert.equal(await sold("female"), 2, "inventory is decremented once");
  // A retry under a different session id but the same payment is the same order.
  const viaSession = await one("select * from create_cart_order($1, $2, $3::uuid, $4, $5, $6, $7)", [
    "cs_test_other_session", first.pi, first.res.cart_id, "Test Buyer", "buyer@example.com", first.res.snapshot.total, "usd",
  ]);
  assert.equal(viaSession.outcome, "exists");
});

test("a payment bound to another cart or payment intent is rejected", async () => {
  const res = await reserve([{ tierId: "female", quantity: 1 }]);
  await attach(res, "pi_the_real_one");
  const out = await fulfil(res, "pi_someone_else");
  assert.equal(out.outcome, "rejected");
  assert.equal((await rows("select 1 from orders")).length, 0);
  const missing = await one("select * from create_cart_order($1,$2,$3::uuid,$4,$5,$6,$7)", [
    "pi_x", "pi_x", "00000000-0000-4000-8000-0000000000ff", "A B", "a@b.co", 1799, "usd",
  ]);
  assert.equal(missing.outcome, "rejected");
});

test("a cart is held atomically: if one line cannot be held, no line is held", async () => {
  // Early Bird has capacity 10. Nine are already sold.
  const prior = await buy([{ tierId: "early-bird", quantity: 9 }]);
  assert.equal(prior.outcome, "created");

  const res = await reserve([
    { tierId: "female", quantity: 2 },
    { tierId: "early-bird", quantity: 2 },
  ]);
  assert.equal(res.ok, false);
  assert.match(res.error, /sold_out:early-bird/);
  assert.equal(await held("female"), 0, "Female is not left held after Early Bird fails");
  assert.equal(await held("early-bird"), 0);
  assert.equal((await rows("select 1 from checkout_holds")).length, 0);
  assert.equal((await rows("select 1 from checkout_hold_items")).length, 0);
  assert.equal((await rows("select 1 from checkout_carts")).length, 1, "only the earlier paid cart; the failed one left no snapshot");

  // The last Early Bird plus a Female does fit.
  const ok = await reserve([
    { tierId: "female", quantity: 2 },
    { tierId: "early-bird", quantity: 1 },
  ]);
  assert.ok(ok.ok, ok.error);
  assert.equal(await held("female"), 2);
  assert.equal(await held("early-bird"), 1);
});

test("two buyers for the last Early Bird: exactly one wins; the loser holds nothing", async () => {
  await buy([{ tierId: "early-bird", quantity: 9 }]);
  const first = await reserve([{ tierId: "early-bird", quantity: 1 }, { tierId: "female", quantity: 1 }]);
  const second = await reserve([{ tierId: "early-bird", quantity: 1 }, { tierId: "general", quantity: 1 }]);
  assert.ok(first.ok);
  assert.equal(second.ok, false);
  assert.equal(await held("early-bird"), 1);
  assert.equal(await held("general"), 0);
  // The loser's hold never existed, so paying the winner still fits.
  const pi = nextPi();
  await attach(first, pi);
  assert.equal((await fulfil(first, pi)).outcome, "created");
  assert.equal(await sold("early-bird"), 10);
});

test("fulfilment re-checks inventory: a line sold out meanwhile makes the whole order 'oversold'", async () => {
  await buy([{ tierId: "early-bird", quantity: 9 }]);
  const res = await reserve([{ tierId: "female", quantity: 1 }, { tierId: "early-bird", quantity: 1 }]);
  assert.ok(res.ok);
  const pi = nextPi();
  await attach(res, pi);
  // The hold lapses and another buyer takes the last Early Bird.
  await db.query("update checkout_holds set expires_at = now() - interval '1 minute' where id = $1", [res.hold_id]);
  await buy([{ tierId: "early-bird", quantity: 1 }]);
  const out = await fulfil(res, pi);
  assert.equal(out.outcome, "oversold");
  assert.equal(await sold("female"), 0, "no partial order: the Female line is not created either");
  assert.equal((await rows("select 1 from orders where stripe_payment_intent = $1", [pi])).length, 0);
});

test("reserve_cart rejects inactive, private, unknown and malformed lines", async () => {
  await db.exec(`insert into tiers (event_id, tier_id, name, price_cents, currency, admits, active)
                 values ('${EVENT}', 'vip', 'VIP', 5000, 'usd', 1, false)`);
  const cases = [
    ["inactive tier (Group of 8)", [{ tierId: "group-8", quantity: 1 }], /unavailable/],
    ["inactive VIP row", [{ tierId: "vip", quantity: 1 }], /unavailable/],
    ["complimentary is not a tier", [{ tierId: "complimentary", quantity: 1 }], /unavailable/],
    ["unknown tier", [{ tierId: "nope", quantity: 1 }], /unavailable/],
    ["zero quantity", [{ tierId: "female", quantity: 0 }], /bad_quantity/],
    ["negative quantity", [{ tierId: "female", quantity: -3 }], /bad_quantity/],
    ["over max_per_order", [{ tierId: "female", quantity: 11 }], /too_many|bad_quantity/],
    ["duplicate lines", [{ tierId: "female", quantity: 1 }, { tierId: "female", quantity: 1 }], /duplicate_item/],
    ["over 20 admissions", [{ tierId: "group", quantity: 3 }, { tierId: "couple", quantity: 3 }], /too_many_admissions/],
  ];
  for (const [name, items, pattern] of cases) {
    const res = await reserve(items, { malformed: true });
    assert.equal(res.ok, false, name);
    assert.match(res.error, pattern, name);
  }
  assert.equal((await rows("select 1 from checkout_holds")).length, 0);
  assert.equal((await rows("select 1 from checkout_carts")).length, 0);
});

test("the admission cap counts people, not line items", async () => {
  const exactly20 = await reserve([{ tierId: "group", quantity: 3 }, { tierId: "couple", quantity: 2 }, { tierId: "female", quantity: 1 }]);
  assert.ok(exactly20.ok, exactly20.error);
  const twentyOne = await reserve([{ tierId: "group", quantity: 3 }, { tierId: "couple", quantity: 2 }, { tierId: "female", quantity: 2 }], { malformed: true });
  assert.equal(twentyOne.ok, false);
  assert.match(twentyOne.error, /too_many_admissions/);
  // Four line items is nothing; 4 × Group of 5 is 20 people and fits, a fifth does not.
  assert.ok((await reserve([{ tierId: "group", quantity: 4 }])).ok);
});

test("the same idempotency key returns the same hold; a changed cart under that key is refused", async () => {
  const key = nextKey();
  const first = await reserve([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }], { key });
  const again = await reserve([{ tierId: "couple", quantity: 1 }, { tierId: "female", quantity: 1 }], { key });
  assert.ok(first.ok && again.ok);
  assert.equal(again.already, true);
  assert.equal(again.hold_id, first.hold_id);
  assert.equal(await held("female"), 1, "the retry did not double-hold");
  const changed = await reserve([{ tierId: "female", quantity: 2 }, { tierId: "couple", quantity: 1 }], { key });
  assert.equal(changed.ok, false);
  assert.match(changed.error, /idempotency_mismatch/);
});

test("an expired unpaid hold stops counting and the key can be reserved again", async () => {
  const key = nextKey();
  const first = await reserve([{ tierId: "early-bird", quantity: 2 }, { tierId: "female", quantity: 1 }], { key });
  assert.equal(await held("early-bird"), 2);
  await db.query("update checkout_holds set expires_at = now() - interval '1 minute' where id = $1", [first.hold_id]);
  assert.equal(await held("early-bird"), 0, "lapsed holds free their inventory");
  const again = await reserve([{ tierId: "early-bird", quantity: 2 }, { tierId: "female", quantity: 1 }], { key });
  assert.ok(again.ok, again.error);
  assert.equal(await held("early-bird"), 2);
  assert.equal((await rows("select 1 from checkout_carts")).length, 1);
});

test("holds from carts and from single tickets add up in the public availability counts", async () => {
  await db.exec(`select reserve_passes('${EVENT}', 'early-bird', 2, 'legacy-hold-key-0000001')`);
  await reserve([{ tierId: "early-bird", quantity: 3 }, { tierId: "female", quantity: 1 }]);
  assert.equal(await held("early-bird"), 5);
  const holds = Object.fromEntries((await rows("select * from event_holds($1)", [EVENT])).map((r) => [r.tier_id, r.quantity]));
  assert.deepEqual(holds, { "early-bird": 5, female: 1 });
  await buy([{ tierId: "female", quantity: 2 }, { tierId: "early-bird", quantity: 1 }]);
  await db.exec(`select create_order_with_tickets('cs_legacy_1', 'pi_legacy_1', '${EVENT}', 'general', 'Male', 1, 1, 'Old Buyer', 'old@example.com', 1999, 'usd')`);
  const salesRows = Object.fromEntries((await rows("select * from event_sales($1)", [EVENT])).map((r) => [r.tier_id, r.quantity]));
  assert.deepEqual(salesRows, { female: 2, "early-bird": 1, general: 1 });
});

test("a full refund cancels every pass, restores every line, and keeps the snapshots and promo attribution", async () => {
  const out = await buy(
    [
      { tierId: "female", quantity: 2 },
      { tierId: "general", quantity: 1 },
      { tierId: "group", quantity: 1 },
    ],
    { promo: GISO15 },
  );
  assert.equal(await sold("female"), 2);
  assert.equal(await sold("general"), 1);
  assert.equal(await sold("group"), 1);
  // Scan one pass before the refund so a checked-in pass is covered.
  const live = await rows("select token from tickets where order_id = $1 order by guest_number", [out.order_id]);
  await db.query("select * from check_in_ticket($1, $2, 'door', 'test')", [live[0].token, EVENT]);

  const cancelled = await one("select cancel_order_by_payment_intent($1, true) as n", [out.pi]);
  assert.equal(cancelled.n, live.length - 1, "valid passes are cancelled; the one already scanned keeps its record");
  const order = await one("select * from orders where id = $1", [out.order_id]);
  assert.equal(order.status, "refunded");
  assert.equal(order.promo_code, "GISO15");
  assert.equal(order.discount_amount_cents, 270 * 2 + 300);
  assert.equal((await rows("select 1 from order_items where order_id = $1", [out.order_id])).length, 3, "item snapshots survive the refund");
  const statuses = (await tickets(out.order_id)).map((t) => t.status);
  assert.equal(statuses.filter((s) => s === "valid").length, 0);
  for (const tier of ["female", "general", "group"]) assert.equal(await sold(tier), 0, `${tier} restored`);

  // Idempotent: a second refund event changes nothing.
  assert.equal((await one("select cancel_order_by_payment_intent($1, true) as n", [out.pi])).n, 0);
  // The inventory is genuinely reusable.
  assert.ok((await reserve([{ tierId: "group", quantity: 1 }])).ok);
});

test("a refund that lands before the order is written still cancels the passes", async () => {
  const res = await reserve([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  const pi = nextPi();
  await attach(res, pi);
  await db.query("select cancel_order_by_payment_intent($1, true)", [pi]);
  const out = await fulfil(res, pi);
  assert.equal(out.outcome, "created");
  assert.equal((await one("select status from orders where id = $1", [out.order_id])).status, "refunded");
  assert.ok((await tickets(out.order_id)).every((t) => t.status === "cancelled"));
  assert.equal(await sold("female"), 0);
});

test("a partial refund flags the order and leaves passes and inventory alone (full-order refunds only)", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  await db.query("select cancel_order_by_payment_intent($1, false)", [out.pi]);
  assert.equal((await one("select status from orders where id = $1", [out.order_id])).status, "partially-refunded");
  assert.equal((await tickets(out.order_id)).filter((t) => t.status === "valid").length, 3);
  assert.equal(await sold("female"), 1);
  assert.equal(await sold("couple"), 1);
});

test("the scanner is unchanged: VALID once, then ALREADY USED, and each pass carries its own ticket type", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  const passes = await rows("select token, tier_id, guest_number from tickets where order_id = $1 order by guest_number", [out.order_id]);
  const first = await one("select * from check_in_ticket($1, $2, 'door-1', 'phone')", [passes[0].token, EVENT]);
  assert.equal(first.outcome, "admitted");
  assert.equal(first.tier_name, "Female");
  assert.equal(first.guest_count, 3);
  const repeat = await one("select * from check_in_ticket($1, $2, 'door-1', 'phone')", [passes[0].token, EVENT]);
  assert.equal(repeat.outcome, "already-used");
  const couple = await one("select * from check_in_ticket($1, $2, 'door-2', 'phone')", [passes[2].token, EVENT]);
  assert.equal(couple.outcome, "admitted");
  assert.equal(couple.tier_name, "Couple");
  const wrong = await one("select * from check_in_ticket($1, 'evt_other', 'door-2', 'phone')", [passes[1].token]);
  assert.equal(wrong.outcome, "wrong-event");
});

test("historical single-ticket orders keep their exact shape, counts and scan label", async () => {
  await db.exec(`select create_order_with_tickets('cs_hist_1', 'pi_hist_1', '${EVENT}', 'couple', 'Couple', 2, 2, 'Old Buyer', 'old@example.com', 5998, 'usd')`);
  const order = await one("select * from orders where stripe_payment_intent = 'pi_hist_1'");
  assert.equal(order.tier_id, "couple");
  assert.equal(order.quantity, 2);
  assert.equal((await rows("select 1 from order_items")).length, 0);
  assert.equal((await tickets(order.id)).length, 4);
  assert.equal(await sold("couple"), 2);
  const token = (await one("select token from tickets where order_id = $1 limit 1", [order.id])).token;
  const scan = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [token, EVENT]);
  assert.equal(scan.tier_name, "Couple");
  // A new cart order for the same tier adds to, never replaces, the historical count.
  await buy([{ tierId: "couple", quantity: 1 }]);
  assert.equal(await sold("couple"), 3);
  await db.query("select cancel_order_by_payment_intent('pi_hist_1', true)");
  assert.equal(await sold("couple"), 1);
});

test("complimentary admissions stay outside paid inventory", async () => {
  await db.exec(`select issue_complimentary_tickets('${EVENT}', 'Guest Name', 'guest@example.com', null, 3, 'comp-key-0000000001', null)`);
  assert.equal((await rows("select 1 from tickets where tier_id = 'complimentary'")).length, 3);
  assert.equal(await sold("complimentary"), 0);
  assert.deepEqual(await rows("select * from event_sales($1)", [EVENT]), []);
});

test("order items and cart snapshots cannot be rewritten", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  await assert.rejects(() => db.query("update order_items set unit_price_cents = 1 where order_id = $1", [out.order_id]), /order_items_immutable/);
  await assert.rejects(() => db.query("update orders set discount_amount_cents = 9999 where id = $1", [out.order_id]), /order_pricing_immutable/);
  await assert.rejects(() => db.query("update checkout_carts set total_cents = 1 where id = $1", [out.res.cart_id]), /checkout_cart_immutable/);
  await assert.rejects(
    () => db.query("update checkout_carts set payment_intent_id = 'pi_other' where id = $1", [out.res.cart_id]),
    /checkout_cart_immutable/,
  );
});

test("the line math is enforced by the database, not just by the caller", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }]);
  const bad = (sql) => assert.rejects(() => db.exec(sql), /violates check constraint/);
  await bad(`insert into order_items (order_id, event_id, position, tier_id, display_name_snapshot, unit_price_cents, quantity, admissions_per_unit, total_admissions, original_line_subtotal_cents, discounted_line_subtotal_cents, line_total_cents)
             values ('${out.order_id}', '${EVENT}', 5, 'x1', 'X', 100, 2, 1, 2, 999, 999, 999)`);
  await bad(`insert into order_items (order_id, event_id, position, tier_id, display_name_snapshot, unit_price_cents, quantity, admissions_per_unit, total_admissions, original_line_subtotal_cents, promo_eligible, eligible_discount_cents, discounted_line_subtotal_cents, line_total_cents)
             values ('${out.order_id}', '${EVENT}', 6, 'x2', 'X', 100, 1, 1, 1, 100, false, 15, 85, 85)`);
});

test("the dispute path cancels every pass of a mixed order", async () => {
  const out = await buy([{ tierId: "female", quantity: 1 }, { tierId: "group", quantity: 1 }]);
  await db.query("select mark_payment_disputed($1)", [out.pi]);
  assert.equal((await one("select status from orders where id = $1", [out.order_id])).status, "disputed");
  assert.equal((await tickets(out.order_id)).filter((t) => t.status === "valid").length, 0);
});
