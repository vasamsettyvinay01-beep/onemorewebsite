// Complimentary revocation and cash sales, executed against the real migrations.
import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVENT, GISO15_ID, openDatabase, seedTiers } from "./pg-harness.mjs";
import { buildCartSnapshot, priceCart } from "../supabase/functions/_shared/cart.mjs";

const ACTOR = "11111111-1111-4111-8111-111111111111";

let db;

before(async () => {
  db = await openDatabase();
  await db.query("insert into auth.users (id, email) values ($1, 'ops@example.com')", [ACTOR]);
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
const tickets = async (orderId) => rows("select guest_number, status, token, tier_id, revoked_by from tickets where order_id = $1 order by guest_number", [orderId]);

const GISO15 = { id: GISO15_ID, code: "GISO15", percent: 15, eligibleTierIds: ["female", "general"] };
const fakeTax = (cents) => Math.round(cents * 0.0825);
let seq = 0;
const key = () => `ops-key-${String(++seq).padStart(12, "0")}`;

async function snapshotFor(items, { promo = null, tax = null, mutate } = {}) {
  const tiers = await rows("select * from tiers where event_id = $1", [EVENT]);
  const lines = items.map((item) => {
    const tier = tiers.find((row) => row.tier_id === item.tierId);
    return {
      tierId: item.tierId,
      name: tier?.name ?? item.name ?? item.tierId,
      unitCents: item.unitCents ?? tier?.price_cents ?? 1,
      quantity: item.quantity,
      admits: item.admits ?? tier?.admits ?? 1,
    };
  });
  const priced = priceCart(lines, promo);
  const snapshot = buildCartSnapshot({
    priced,
    tax: tax ?? fakeTax(priced.discountedSubtotal),
    currency: "usd",
    promo,
  });
  if (mutate) mutate(snapshot);
  return { snapshot, priced };
}

async function cash(items, options = {}) {
  const { snapshot } = await snapshotFor(items, options);
  const result = await one(
    "select * from create_cash_order($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8)",
    [
      EVENT,
      JSON.stringify(items.map((item) => ({ tier_id: item.tierId, quantity: item.quantity }))),
      JSON.stringify(snapshot),
      options.name ?? "Cash Buyer",
      options.email ?? "cash@example.com",
      options.phone ?? "",
      options.idempotencyKey ?? key(),
      ACTOR,
    ],
  );
  return { ...result, snapshot };
}

async function issueComplimentary(count = 3, idempotency = key()) {
  return one(
    "select * from issue_complimentary_tickets($1, 'Guest Name', 'guest@example.com', null, $2, $3, $4)",
    [EVENT, count, idempotency, ACTOR],
  );
}

test("an individual complimentary pass can be revoked without touching the others", async () => {
  const issued = await issueComplimentary(3);
  assert.equal(issued.outcome, "created");
  const revoked = await one("select * from revoke_complimentary_pass($1, $2, 2, $3)", [EVENT, issued.order_id, ACTOR]);
  assert.equal(revoked.outcome, "revoked");
  const passes = await tickets(issued.order_id);
  assert.deepEqual(passes.map((pass) => pass.status), ["valid", "revoked", "valid"]);
  assert.equal(passes[1].revoked_by, ACTOR);
  const scan = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[1].token, EVENT]);
  assert.equal(scan.outcome, "revoked");
  assert.equal((await tickets(issued.order_id))[1].status, "revoked");
  assert.equal((await one("select outcome from scans where token = $1", [passes[1].token])).outcome, "revoked");
  const stillValid = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[0].token, EVENT]);
  assert.equal(stillValid.outcome, "admitted");
  assert.equal((await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[2].token, EVENT])).outcome, "admitted");
});

test("revoking the remainder leaves a used pass used and a revoked pass revoked", async () => {
  const issued = await issueComplimentary(3);
  await db.query("select revoke_complimentary_pass($1, $2, 2, $3)", [EVENT, issued.order_id, ACTOR]);
  const first = (await tickets(issued.order_id))[0];
  assert.equal((await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [first.token, EVENT])).outcome, "admitted");
  const used = await one("select * from revoke_complimentary_pass($1, $2, 1, $3)", [EVENT, issued.order_id, ACTOR]);
  assert.equal(used.outcome, "used");
  const whole = await one("select * from revoke_complimentary_remaining($1, $2, $3)", [EVENT, issued.order_id, ACTOR]);
  assert.equal(whole.outcome, "revoked");
  assert.equal(whole.revoked_count, 1);
  assert.deepEqual((await tickets(issued.order_id)).map((pass) => pass.status), ["checked-in", "revoked", "revoked"]);
  const again = await one("select * from revoke_complimentary_remaining($1, $2, $3)", [EVENT, issued.order_id, ACTOR]);
  assert.equal(again.outcome, "none_remaining");
  assert.equal((await rows("select 1 from tickets where order_id = $1", [issued.order_id])).length, 3);
  assert.equal(await sold("female"), 0);
});

test("a cash sale is one paid order with normal tickets and no Stripe id", async () => {
  const sale = await cash([{ tierId: "female", quantity: 1 }]);
  assert.equal(sale.outcome, "created");
  const order = await one("select * from orders where id = $1", [sale.order_id]);
  assert.equal(order.payment_method, "cash");
  assert.equal(order.status, "paid");
  assert.equal(order.is_complimentary, false);
  assert.equal(order.stripe_payment_intent, null);
  assert.match(order.stripe_session_id, /^cash_/);
  assert.equal(order.cash_received_cents, order.amount_total);
  assert.equal(order.amount_total, sale.snapshot.total);
  assert.equal(order.original_subtotal_cents, 1799);
  assert.equal(order.discount_amount_cents, 0);
  assert.equal(order.tax_cents, sale.snapshot.tax);
  assert.equal(order.final_total_cents, sale.snapshot.total);
  assert.equal(order.issued_by, ACTOR);
  assert.ok(order.paid_at);
  const passes = await tickets(sale.order_id);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].status, "valid");
  assert.equal(passes[0].tier_id, "female");
  assert.equal(await sold("female"), 1);
  const scan = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[0].token, EVENT]);
  assert.equal(scan.outcome, "admitted");
  assert.equal(scan.tier_name, "Female");
  const repeat = await one("select * from check_in_ticket($1, $2, 'door', 'phone')", [passes[0].token, EVENT]);
  assert.equal(repeat.outcome, "already-used");
});

test("a mixed cash sale prices GISO15 on Female only and issues every admission", async () => {
  const sale = await cash(
    [{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }],
    { promo: GISO15 },
  );
  assert.equal(sale.outcome, "created");
  const order = await one("select * from orders where id = $1", [sale.order_id]);
  assert.equal(order.tier_id, "mixed");
  assert.equal(order.promo_code, "GISO15");
  assert.equal(order.discount_amount_cents, Math.floor((1799 * 15 + 50) / 100));
  const items = await rows("select tier_id, quantity, total_admissions, promo_eligible, eligible_discount_cents, original_line_subtotal_cents from order_items where order_id = $1 order by position", [sale.order_id]);
  assert.equal(items.length, 2);
  assert.equal(items[0].promo_eligible, true);
  assert.equal(Number(items[0].eligible_discount_cents), order.discount_amount_cents);
  assert.equal(items[1].tier_id, "couple");
  assert.equal(items[1].promo_eligible, false);
  assert.equal(Number(items[1].eligible_discount_cents), 0);
  assert.equal(Number(items[1].original_line_subtotal_cents), 2999);
  assert.equal((await tickets(sale.order_id)).length, 3);
  assert.equal(await sold("female"), 1);
  assert.equal(await sold("couple"), 1);
});

test("a group cash sale decrements inventory by units and creates one pass per admission", async () => {
  const sale = await cash([{ tierId: "group", quantity: 1 }]);
  assert.equal(sale.outcome, "created");
  assert.equal((await tickets(sale.order_id)).length, 5);
  assert.equal(await sold("group"), 1);
});

test("the same cash confirmation cannot create a second order", async () => {
  const idempotencyKey = key();
  const first = await cash([{ tierId: "female", quantity: 2 }], { idempotencyKey });
  const second = await cash([{ tierId: "female", quantity: 2 }], { idempotencyKey });
  assert.equal(first.outcome, "created");
  assert.equal(second.outcome, "exists");
  assert.equal(second.order_id, first.order_id);
  assert.equal((await rows("select 1 from orders where payment_method = 'cash'")).length, 1);
  assert.equal((await tickets(first.order_id)).length, 2);
  assert.equal(await sold("female"), 2);
});

test("a changed replay of a cash confirmation is rejected and creates nothing", async () => {
  const idempotencyKey = key();
  await cash([{ tierId: "female", quantity: 1 }], { idempotencyKey });
  const mismatch = await cash([{ tierId: "female", quantity: 1 }], { idempotencyKey, email: "other@example.com" });
  assert.equal(mismatch.outcome, "idempotency_mismatch");
  assert.equal(mismatch.order_id, null);
  assert.equal(await sold("female"), 1);
});

test("cash sales reject sold-out, inactive, VIP, complimentary, and a bad price without a partial order", async () => {
  await db.query("update tiers set capacity = 1 where tier_id = 'female'");
  const first = await cash([{ tierId: "female", quantity: 1 }]);
  assert.equal(first.outcome, "created");
  const oversold = await cash([{ tierId: "female", quantity: 1 }], { email: "next@example.com" });
  assert.equal(oversold.outcome, "oversold");
  assert.equal(oversold.order_id, null);
  assert.equal(await sold("female"), 1);

  const inactive = await cash([{ tierId: "group-8", quantity: 1 }]);
  assert.equal(inactive.outcome, "unavailable");
  const vip = await cash([{ tierId: "vip", quantity: 1, name: "VIP", unitCents: 1, admits: 1 }]);
  assert.equal(vip.outcome, "unavailable");
  const complimentary = await cash([{ tierId: "complimentary", quantity: 1, name: "Complimentary", unitCents: 0, admits: 1 }]);
  assert.equal(complimentary.outcome, "unavailable");
  const tampered = await cash([{ tierId: "couple", quantity: 1 }], {
    mutate(snapshot) {
      snapshot.lines[0].unitCents = 1;
      snapshot.lines[0].originalLineCents = 1;
    },
  });
  assert.equal(tampered.outcome, "rejected");
  assert.equal((await rows("select 1 from orders")).length, 1);
  assert.equal(await sold("couple"), 0);
});

test("a mixed cash sale that cannot take the second ticket creates nothing", async () => {
  await db.query("update tiers set active = false where tier_id = 'couple'");
  const sale = await cash([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  assert.equal(sale.outcome, "unavailable");
  assert.equal((await rows("select 1 from orders")).length, 0);
  assert.equal((await rows("select 1 from tickets")).length, 0);
  assert.equal(await sold("female"), 0);
});

test("a cash refund cancels unused passes, restores inventory, and keeps the price snapshot", async () => {
  const sale = await cash([{ tierId: "female", quantity: 2 }]);
  const before = await one("select original_subtotal_cents, discount_amount_cents, tax_cents, final_total_cents, amount_total, stripe_payment_intent from orders where id = $1", [sale.order_id]);
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(refund.outcome, "refunded");
  assert.equal(refund.cancelled_count, 2);
  const order = await one("select * from orders where id = $1", [sale.order_id]);
  assert.equal(order.status, "refunded");
  assert.equal(order.cash_refund_cents, before.amount_total);
  assert.equal(order.cash_refunded_by, ACTOR);
  assert.ok(order.cash_refunded_at);
  assert.equal(order.stripe_payment_intent, null);
  assert.equal(order.original_subtotal_cents, before.original_subtotal_cents);
  assert.equal(order.tax_cents, before.tax_cents);
  assert.equal(order.final_total_cents, before.final_total_cents);
  assert.deepEqual((await tickets(sale.order_id)).map((pass) => pass.status), ["cancelled", "cancelled"]);
  assert.equal(await sold("female"), 0);
  const again = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(again.outcome, "exists");
  assert.equal((await rows("select 1 from orders")).length, 1);
});

test("an unused Female cash sale refunds once and restores inventory once", async () => {
  const sale = await cash([{ tierId: "female", quantity: 1 }]);
  assert.equal(await sold("female"), 1);
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(refund.outcome, "refunded");
  assert.equal(refund.cancelled_count, 1);
  const order = await one("select status, payment_method, cash_refunded_by from orders where id = $1", [sale.order_id]);
  assert.equal(order.status, "refunded");
  assert.equal(order.payment_method, "cash");
  assert.equal(order.cash_refunded_by, ACTOR);
  assert.deepEqual((await tickets(sale.order_id)).map((pass) => pass.status), ["cancelled"]);
  assert.equal(await sold("female"), 0);
  const again = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(again.outcome, "exists");
  assert.equal(await sold("female"), 0);
});

test("an unused mixed cash sale refunds every line and restores every tier", async () => {
  const sale = await cash([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  assert.equal((await tickets(sale.order_id)).length, 3);
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(refund.outcome, "refunded");
  assert.equal(refund.cancelled_count, 3);
  assert.deepEqual((await tickets(sale.order_id)).map((pass) => pass.status), ["cancelled", "cancelled", "cancelled"]);
  const order = await one("select status, payment_method from orders where id = $1", [sale.order_id]);
  assert.equal(order.status, "refunded");
  assert.equal(order.payment_method, "cash");
  assert.equal(await sold("female"), 0);
  assert.equal(await sold("couple"), 0);
});

test("a cash refund is blocked once any ticket has been admitted", async () => {
  const sale = await cash([{ tierId: "female", quantity: 1 }]);
  const pass = (await tickets(sale.order_id))[0];
  assert.equal((await one("select outcome from check_in_ticket($1, $2, 'door', 'phone')", [pass.token, EVENT])).outcome, "admitted");
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(refund.outcome, "admitted");
  assert.equal(refund.cancelled_count, 0);
  const order = await one("select status, cash_refunded_at, cash_refund_cents from orders where id = $1", [sale.order_id]);
  assert.equal(order.status, "paid");
  assert.equal(order.cash_refunded_at, null);
  assert.equal(order.cash_refund_cents, null);
  assert.equal((await tickets(sale.order_id))[0].status, "checked-in");
  assert.equal(await sold("female"), 1);
});

test("a partially used mixed cash sale cannot be refunded and keeps its inventory", async () => {
  const sale = await cash([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }]);
  const passes = await tickets(sale.order_id);
  assert.equal((await one("select outcome from check_in_ticket($1, $2, 'door', 'phone')", [passes[0].token, EVENT])).outcome, "admitted");
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, sale.order_id, ACTOR]);
  assert.equal(refund.outcome, "admitted");
  const after = await tickets(sale.order_id);
  assert.equal(after[0].status, "checked-in");
  assert.deepEqual(after.slice(1).map((pass) => pass.status), ["valid", "valid"]);
  assert.equal((await one("select status from orders where id = $1", [sale.order_id])).status, "paid");
  assert.equal(await sold("female"), 1);
  assert.equal(await sold("couple"), 1);
});

test("a card order cannot be refunded through the cash path", async () => {
  await db.query(
    "select create_order_with_tickets('cs_card_1', 'pi_card_1', $1, 'female', 'Female', 1, 1, 'Card Buyer', 'card@example.com', 1799, 'usd')",
    [EVENT],
  );
  const order = await one("select id from orders where stripe_payment_intent = 'pi_card_1'");
  const refund = await one("select * from refund_cash_order($1, $2, $3)", [EVENT, order.id, ACTOR]);
  assert.equal(refund.outcome, "not_found");
  assert.equal((await one("select status, stripe_payment_intent from orders where id = $1", [order.id])).status, "paid");
});
