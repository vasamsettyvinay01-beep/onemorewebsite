// Door check-in and the admin check-in counts, executed against the real migrations.
// The admin counts are rebuilt here the way the admin function reads them:
// paid tickets (card and cash, not test, not complimentary) and complimentary tickets,
// each counted with ticketCounts and combined with doorTotals.
import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVENT, openDatabase, seedTiers } from "./pg-harness.mjs";
import { buildCartSnapshot, priceCart } from "../supabase/functions/_shared/cart.mjs";
import { ticketCounts, displayScanResult, doorTotals } from "../supabase/functions/_shared/admin-read.mjs";

const ACTOR = "22222222-2222-4222-8222-222222222222";

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
const passes = (orderId) => rows("select id, token, status, checked_in_at from tickets where order_id = $1 order by guest_number", [orderId]);
const scan = (token, by = "door-1") => one("select * from check_in_ticket($1, $2, $3, 'phone')", [token, EVENT, by]);

let seq = 0;
const key = () => `sync-key-${String(++seq).padStart(12, "0")}`;
const nextPi = () => `pi_sync_${String(++seq).padStart(6, "0")}`;
const fakeTax = (cents) => Math.round(cents * 0.0825);

async function snapshot(items) {
  const tiers = await rows("select * from tiers where event_id = $1", [EVENT]);
  const lines = items.map((item) => {
    const tier = tiers.find((row) => row.tier_id === item.tierId);
    return { tierId: item.tierId, name: tier.name, unitCents: tier.price_cents, quantity: item.quantity, admits: tier.admits };
  });
  const priced = priceCart(lines, null);
  return buildCartSnapshot({ priced, tax: fakeTax(priced.discountedSubtotal), currency: "usd", promo: null });
}

/** Card checkout: reserve the cart, attach the payment, fulfil it as the Stripe webhook does. */
async function card(items) {
  const snap = await snapshot(items);
  const res = await one("select * from reserve_cart($1, $2::jsonb, $3, $4::jsonb, $5, $6)", [
    EVENT,
    JSON.stringify(items.map((item) => ({ tier_id: item.tierId, quantity: item.quantity }))),
    `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    JSON.stringify(snap),
    "usd",
    snap.total,
  ]);
  const pi = nextPi();
  await db.query("update checkout_carts set payment_intent_id = $1 where id = $2", [pi, res.cart_id]);
  await db.query("update checkout_holds set payment_intent_id = $1 where id = $2", [pi, res.hold_id]);
  const out = await one("select * from create_cart_order($1, $2, $3::uuid, $4, $5, $6, $7)", [pi, pi, res.cart_id, "Card Buyer", "card@example.com", snap.total, "usd"]);
  assert.equal(out.outcome, "created");
  return { orderId: out.order_id, pi };
}

async function cash(items) {
  const snap = await snapshot(items);
  const out = await one("select * from create_cash_order($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8)", [
    EVENT,
    JSON.stringify(items.map((item) => ({ tier_id: item.tierId, quantity: item.quantity }))),
    JSON.stringify(snap),
    "Cash Buyer",
    "cash@example.com",
    "",
    key(),
    ACTOR,
  ]);
  assert.equal(out.outcome, "created");
  return { orderId: out.order_id };
}

async function complimentary(count) {
  const out = await one("select * from issue_complimentary_tickets($1, 'Guest Name', 'guest@example.com', null, $2, $3, $4)", [EVENT, count, key(), ACTOR]);
  assert.equal(out.outcome, "created");
  return { orderId: out.order_id };
}

/** What the admin Check-in page reports. */
async function dashboard() {
  const all = await rows(
    "select t.status, o.is_complimentary from tickets t join orders o on o.id = t.order_id where t.event_id = $1 and not o.is_test",
    [EVENT],
  );
  const paid = ticketCounts(all.filter((row) => !row.is_complimentary));
  const comp = ticketCounts(all.filter((row) => row.is_complimentary));
  return { paid, comp, total: doorTotals(paid, comp) };
}

test("normal paid ticket: first scan admits and persists, rescan is already used, count stays 1", async () => {
  const { orderId } = await card([{ tierId: "female", quantity: 1 }]);
  const [ticket] = await passes(orderId);
  assert.equal((await dashboard()).total.checkedIn, 0);

  const first = await scan(ticket.token);
  assert.equal(first.outcome, "admitted");
  const stored = (await passes(orderId))[0];
  assert.equal(stored.status, "checked-in");
  assert.ok(stored.checked_in_at);
  assert.equal((await dashboard()).total.checkedIn, 1);

  const again = await scan(ticket.token);
  assert.equal(again.outcome, "already-used");
  assert.equal(displayScanResult(again.outcome, "paid"), "ALREADY USED");
  assert.equal((await passes(orderId))[0].checked_in_at.getTime(), stored.checked_in_at.getTime());
  const after = await dashboard();
  assert.equal(after.total.checkedIn, 1);
  assert.equal(after.total.remaining, 0);
});

test("couple, group of 5 and group of 8 count individual admissions", async () => {
  const couple = await passes((await card([{ tierId: "couple", quantity: 1 }])).orderId);
  const group5 = await passes((await card([{ tierId: "group", quantity: 1 }])).orderId);
  const group8 = await passes((await card([{ tierId: "group-8", quantity: 1 }])).orderId);
  assert.deepEqual([couple.length, group5.length, group8.length], [2, 5, 8]);

  await scan(couple[0].token);
  for (const ticket of group5.slice(0, 3)) await scan(ticket.token);
  await scan(group8[0].token);

  const counted = async (orderTickets) => ticketCounts(await rows("select status from tickets where id = any($1::uuid[])", [orderTickets.map((t) => t.id)]));
  assert.deepEqual(await counted(couple), { issued: 2, expected: 2, checkedIn: 1, remaining: 1, cancelled: 0 });
  assert.deepEqual(await counted(group5), { issued: 5, expected: 5, checkedIn: 3, remaining: 2, cancelled: 0 });
  assert.deepEqual(await counted(group8), { issued: 8, expected: 8, checkedIn: 1, remaining: 7, cancelled: 0 });
  const total = (await dashboard()).total;
  assert.equal(total.expected, 15);
  assert.equal(total.checkedIn, 5);
  assert.equal(total.remaining, 10);
});

test("mixed cart: every generated ticket scans and counts once", async () => {
  const { orderId } = await card([{ tierId: "female", quantity: 1 }, { tierId: "couple", quantity: 1 }, { tierId: "group", quantity: 1 }]);
  const tickets = await passes(orderId);
  assert.equal(tickets.length, 8);
  await scan(tickets[0].token);
  await scan(tickets[1].token);
  await scan(tickets[1].token);
  const { paid } = await dashboard();
  assert.equal(paid.checkedIn, 2);
  assert.equal(paid.remaining, 6);
});

test("cash ticket updates the same paid check-in count", async () => {
  const [ticket] = await passes((await cash([{ tierId: "general", quantity: 1 }])).orderId);
  assert.equal((await scan(ticket.token)).outcome, "admitted");
  const { paid, total } = await dashboard();
  assert.equal(paid.checkedIn, 1);
  assert.equal(total.checkedIn, 1);
});

test("complimentary: a scanned pass shows on the door dashboard, a revoked pass is neither used nor remaining", async () => {
  const { orderId } = await complimentary(3);
  const [first, second] = await passes(orderId);
  await db.query("select revoke_complimentary_pass($1, $2, 2, $3)", [EVENT, orderId, ACTOR]);
  assert.equal((await scan(first.token)).outcome, "admitted");
  assert.equal((await scan(second.token)).outcome, "revoked");

  const { paid, comp, total } = await dashboard();
  assert.equal(paid.checkedIn, 0);
  assert.deepEqual(comp, { issued: 3, expected: 2, checkedIn: 1, remaining: 1, cancelled: 1 });
  assert.equal(total.checkedIn, 1);
  assert.equal(total.remaining, 1);
  assert.equal(total.expected, 2);
});

test("the same QR scanned on two devices at once admits exactly once", async () => {
  const [ticket] = await passes((await card([{ tierId: "general", quantity: 1 }])).orderId);
  const results = await Promise.all([scan(ticket.token, "door-1"), scan(ticket.token, "door-2")]);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["admitted", "already-used"]);
  assert.equal((await dashboard()).total.checkedIn, 1);
  const log = await rows("select outcome from scans where ticket_id = $1 order by id", [ticket.id]);
  assert.deepEqual(log.map((r) => r.outcome), ["admitted", "already-used"]);
});

test("a retry after a lost response is already used and does not admit twice", async () => {
  const [ticket] = await passes((await cash([{ tierId: "female", quantity: 1 }])).orderId);
  await scan(ticket.token);
  const retry = await scan(ticket.token);
  assert.equal(retry.outcome, "already-used");
  assert.equal((await dashboard()).total.checkedIn, 1);
});

test("the dashboard count changes between two reads around a scan", async () => {
  const tickets = await passes((await card([{ tierId: "couple", quantity: 1 }])).orderId);
  const before = await dashboard();
  await scan(tickets[1].token);
  const after = await dashboard();
  assert.equal(after.total.checkedIn, before.total.checkedIn + 1);
  assert.equal(after.total.remaining, before.total.remaining - 1);
});

test("a refunded order's cancelled tickets are neither expected nor remaining, and do not scan", async () => {
  const { orderId, pi } = await card([{ tierId: "couple", quantity: 1 }]);
  const tickets = await passes(orderId);
  await scan(tickets[0].token);
  await db.query("select cancel_order_by_payment_intent($1, true)", [pi]);
  assert.deepEqual((await passes(orderId)).map((t) => t.status), ["checked-in", "cancelled"]);
  assert.equal((await scan(tickets[1].token)).outcome, "cancelled");
  const { paid } = await dashboard();
  assert.deepEqual(paid, { issued: 2, expected: 1, checkedIn: 1, remaining: 0, cancelled: 1 });
});

test("door counts add paid and complimentary admissions", () => {
  const paid = { issued: 10, expected: 9, checkedIn: 4, remaining: 5, cancelled: 1 };
  const comp = { issued: 3, expected: 2, checkedIn: 2, remaining: 0, cancelled: 1 };
  assert.deepEqual(doorTotals(paid, comp), { expected: 11, checkedIn: 6, remaining: 5, cancelled: 2, percent: 54.5 });
  assert.equal(doorTotals(ticketCounts([]), ticketCounts([])).percent, null);
});
