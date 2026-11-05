// Mixed-ticket cart on a REAL Postgres server, with separate connections racing.
//
//   RACE_DATABASE_URL=postgres://postgres:race@127.0.0.1:56543/postgres node --test scripts/race/mixed-cart-race.pg.mjs
//
// Creates a throwaway database, applies every migration in supabase/migrations,
// and drives reserve_cart / reserve_passes / create_cart_order /
// cancel_order_by_payment_intent from independent sessions at the same moment.
// After every round it checks the inventory invariants. Never point this at production:
// it refuses any host that is not local.
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { buildCartSnapshot, priceCart } from "../../supabase/functions/_shared/cart.mjs";

const ADMIN_URL = process.env.RACE_DATABASE_URL;
if (!ADMIN_URL) throw new Error("Set RACE_DATABASE_URL to a disposable local Postgres server.");
const host = new URL(ADMIN_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`Refusing non-local database host ${host}.`);

const ROUNDS = Number(process.env.RACE_ROUNDS ?? 25);
const DB_NAME = `omc_race_${Date.now()}`;
const EVENT = "evt_race";
const GISO15_ID = "8b0f3f8e-0000-4000-8000-0000000000aa";
const GISO15 = { id: GISO15_ID, code: "GISO15", percent: 15, eligibleTierIds: ["female", "general"] };
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

let admin;
let pool;
const tierRows = new Map();

const PLATFORM = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

before(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${DB_NAME}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
  const setup = await pool.connect();
  try {
    await setup.query(PLATFORM);
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      // The 2026-10-09 data migration asserts 17 specific production rows; a fresh database has none.
      let sql = readFileSync(new URL(file, MIGRATIONS), "utf8").replace("if v_count <> 17 then", "if false then");
      // RACE_MUTANT=1 proves the race tests can fail: it strips reserve_cart's tier locks and
      // widens the check-then-insert window. Every race test must then fail.
      if (process.env.RACE_MUTANT === "1" && file.startsWith("20261108000000")) {
        sql = sql
          .replace("where event_id = p_event_id and tier_id = v_item.tier_id and active\n    for update;", "where event_id = p_event_id and tier_id = v_item.tier_id and active;")
          .replace("  insert into checkout_carts (idempotency_key", "  perform pg_sleep(0.05);\n  insert into checkout_carts (idempotency_key");
        assert.doesNotMatch(sql, /and active\n\s*for update;/, "mutation did not apply");
      }
      try {
        await setup.query(sql);
      } catch (err) {
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
    const version = await setup.query("show server_version");
    console.log(`# real postgres ${version.rows[0].server_version}, database ${DB_NAME}`);
  } finally {
    setup.release();
  }
}, { timeout: 180000 });

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`drop database if exists ${DB_NAME} with (force)`);
    await admin.end();
  }
});

/** Capped fixture: every capacity is tiny so each race is for the last units. */
async function seed(caps) {
  await pool.query(`
    truncate orders, checkout_holds, checkout_carts, payment_flags cascade;
    delete from tiers where event_id = '${EVENT}';
    delete from promotions where event_id = '${EVENT}';
  `);
  const defs = [
    ["early-bird", "Early Bird", 1499, 1, caps["early-bird"] ?? 10, true],
    ["female", "Female", 1799, 1, caps.female ?? null, true],
    ["general", "Male", 1999, 1, caps.general ?? null, true],
    ["couple", "Couple", 2999, 2, caps.couple ?? null, true],
    ["group", "Group of 5", 8999, 5, caps.group ?? null, true],
    ["group-8", "Group of 8", 13999, 8, null, false],
  ];
  tierRows.clear();
  for (const [id, name, price, admits, capacity, active] of defs) {
    await pool.query(
      "insert into tiers (event_id, tier_id, name, price_cents, currency, admits, capacity, max_per_order, active) values ($1,$2,$3,$4,'usd',$5,$6,10,$7)",
      [EVENT, id, name, price, admits, capacity, active],
    );
    tierRows.set(id, { name, price, admits, capacity });
  }
  await pool.query(
    "insert into promotions (id, code, event_id, discount_type, discount_value, eligible_tier_ids) values ($1, 'GISO15', $2, 'percentage', 15, array['female','general'])",
    [GISO15_ID, EVENT],
  );
}

let seq = 0;
const key = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

function snapshotFor(items, promo = null) {
  const priced = priceCart(
    items.map(([tierId, quantity]) => {
      const t = tierRows.get(tierId);
      return { tierId, name: t.name, unitCents: t.price, quantity, admits: t.admits };
    }),
    promo,
  );
  return buildCartSnapshot({ priced, tax: Math.round(priced.discountedSubtotal * 0.0825), currency: "usd", promo });
}

/** One reserve_cart call on its own connection, as one checkout request would make. */
async function reserveCart(items, { promo = null, idem = key(), client = null } = {}) {
  const snapshot = snapshotFor(items, promo);
  const conn = client ?? (await pool.connect());
  try {
    const { rows } = await conn.query("select * from reserve_cart($1, $2::jsonb, $3, $4::jsonb, 'usd', $5)", [
      EVENT,
      JSON.stringify(items.map(([tier_id, quantity]) => ({ tier_id, quantity }))),
      idem,
      JSON.stringify(snapshot),
      snapshot.total,
    ]);
    return { ok: true, idem, snapshot, ...rows[0] };
  } catch (err) {
    return { ok: false, idem, snapshot, error: err.message };
  } finally {
    if (!client) conn.release();
  }
}

async function reserveLegacy(tierId, quantity) {
  const conn = await pool.connect();
  try {
    const { rows } = await conn.query("select * from reserve_passes($1, $2, $3, $4)", [EVENT, tierId, quantity, key()]);
    return { ok: true, ...rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    conn.release();
  }
}

/**
 * The invariants that must hold after every round:
 *  - no capped tier is ever over capacity counting paid orders plus live holds
 *  - no availability is negative
 *  - every cart hold carries exactly the lines its snapshot froze (never a partial cart)
 *  - no hold item is orphaned and no cart hold is empty
 */
async function assertInvariants(label) {
  for (const [tierId, t] of tierRows) {
    const { rows } = await pool.query("select tier_sold($1,$2) as sold, tier_held($1,$2) as held", [EVENT, tierId]);
    const { sold, held } = rows[0];
    assert.ok(sold >= 0 && held >= 0, `${label}: negative count on ${tierId}`);
    if (t.capacity != null) {
      assert.ok(sold + held <= t.capacity, `${label}: ${tierId} oversold (${sold} sold + ${held} held > ${t.capacity})`);
    }
  }
  const partial = await pool.query(`
    select h.id
    from checkout_holds h
    join checkout_carts c on c.id = h.cart_id
    where h.cart_id is not null
      and (select count(*) from checkout_hold_items hi where hi.hold_id = h.id) <> jsonb_array_length(c.snapshot->'lines')
  `);
  assert.equal(partial.rowCount, 0, `${label}: a cart hold is missing lines`);
  const mismatched = await pool.query(`
    select hi.hold_id
    from checkout_hold_items hi
    join checkout_holds h on h.id = hi.hold_id
    join checkout_carts c on c.id = h.cart_id
    where not exists (
      select 1 from jsonb_array_elements(c.snapshot->'lines') l
      where l->>'tierId' = hi.tier_id and (l->>'quantity')::int = hi.quantity
    )
  `);
  assert.equal(mismatched.rowCount, 0, `${label}: a held line differs from its frozen cart`);
  const orphans = await pool.query("select 1 from checkout_hold_items hi where not exists (select 1 from checkout_holds h where h.id = hi.hold_id)");
  assert.equal(orphans.rowCount, 0, `${label}: orphan hold items`);
}

async function heldBy(tierId) {
  return (await pool.query("select tier_held($1,$2) as n", [EVENT, tierId])).rows[0].n;
}

/** Proof that a session really blocked on another's tier lock during the race. */
async function waitForLockWait(timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%reserve_%'",
    );
    if (rows[0].n > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

beforeEach(async () => {
  await seed({});
});

test(`two buyers race for the last Female and last Male, ${ROUNDS} rounds: exactly one full cart`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ female: 1, general: 1 });
    // Half the rounds list the lines in opposite orders, which would deadlock without sorted locking.
    const a = [["female", 1], ["general", 1]];
    const b = round % 2 ? [["general", 1], ["female", 1]] : [["female", 1], ["general", 1]];
    const [ra, rb] = await Promise.all([reserveCart(a), reserveCart(b)]);
    const wins = [ra, rb].filter((r) => r.ok);
    assert.equal(wins.length, 1, `round ${round}: ${wins.length} carts held (${ra.error ?? "ok"} / ${rb.error ?? "ok"})`);
    const loser = ra.ok ? rb : ra;
    assert.match(loser.error, /^sold_out:/, `round ${round}: loser failed with ${loser.error}`);
    assert.doesNotMatch(loser.error, /deadlock/);
    assert.equal(await heldBy("female"), 1);
    assert.equal(await heldBy("general"), 1);
    const holds = await pool.query("select count(*)::int as n from checkout_holds");
    assert.equal(holds.rows[0].n, 1, `round ${round}: stray hold`);
    await assertInvariants(`race round ${round}`);
  }
});

test(`a held tier lock makes the rival wait, then fail atomically, ${ROUNDS} rounds`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ female: 1, general: 1 });
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      const first = await reserveCart([["female", 1], ["general", 1]], { client: holder });
      assert.ok(first.ok, first.error);
      // The rival starts while the first transaction still holds both tier locks.
      const rival = reserveCart([["general", 1], ["female", 1]]);
      assert.ok(await waitForLockWait(), `round ${round}: rival never blocked on the tier lock`);
      await holder.query("commit");
      const lost = await rival;
      assert.equal(lost.ok, false, `round ${round}: rival also held`);
      assert.match(lost.error, /^sold_out:/);
    } finally {
      holder.release();
    }
    assert.equal(await heldBy("female"), 1);
    assert.equal(await heldBy("general"), 1);
    await assertInvariants(`lock round ${round}`);
  }
});

test(`overlapping carts never leave one buyer half-held, ${ROUNDS} rounds`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ female: 1, general: 1 });
    // A wants both. B wants only Male, C only Female. Legal outcomes: A alone, or B and C.
    const [ra, rb, rc] = await Promise.all([
      reserveCart([["female", 1], ["general", 1]]),
      reserveCart([["general", 1]]),
      reserveCart([["female", 1]]),
    ]);
    if (ra.ok) {
      assert.equal(rb.ok || rc.ok, false, `round ${round}: A held both and a single also held`);
    } else {
      assert.match(ra.error, /^sold_out:/);
    }
    const cartHolds = (await pool.query("select count(*)::int as n from checkout_holds")).rows[0].n;
    assert.equal(cartHolds, [ra, rb, rc].filter((r) => r.ok).length);
    await assertInvariants(`overlap round ${round}`);
  }
});

test(`Group of 5 races: units are capped per tier and admissions per cart, ${ROUNDS} rounds`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ group: 1, female: 1, couple: 1 });
    const [ra, rb] = await Promise.all([
      reserveCart([["group", 1], ["female", 1]]),
      reserveCart([["couple", 1], ["group", 1]]),
    ]);
    assert.equal([ra, rb].filter((r) => r.ok).length, 1, `round ${round}: both or neither held the last Group of 5`);
    assert.equal(await heldBy("group"), 1);
    const winner = ra.ok ? ra : rb;
    const lines = (await pool.query("select tier_id, quantity from checkout_hold_items where hold_id = $1 order by tier_id", [winner.hold_id])).rows;
    assert.equal(lines.length, 2);
    assert.equal(await heldBy(ra.ok ? "couple" : "female"), 0, `round ${round}: the losing cart's other line was held`);
    await assertInvariants(`group round ${round}`);
  }
  await seed({});
  // 4 × Group of 5 (20) + 1 Female = 21 admissions: refused before anything is held.
  const over = await reserveCart([["group", 4], ["female", 1]]);
  assert.equal(over.ok, false);
  assert.match(over.error, /too_many_admissions/);
  assert.equal((await pool.query("select count(*)::int as n from checkout_holds")).rows[0].n, 0);
  assert.equal((await pool.query("select count(*)::int as n from checkout_carts")).rows[0].n, 0);
});

test("one line available and one not: the whole cart rolls back", async () => {
  await seed({ female: 1, general: 5 });
  const taken = await reserveCart([["female", 1]]);
  assert.ok(taken.ok);
  const mixed = await reserveCart([["general", 2], ["female", 1]]);
  assert.equal(mixed.ok, false);
  assert.match(mixed.error, /^sold_out:female/);
  assert.equal(await heldBy("general"), 0, "Male was held on its own");
  assert.equal((await pool.query("select count(*)::int as n from checkout_carts where idempotency_key = $1", [mixed.idem])).rows[0].n, 0);

  const inactive = await reserveCart([["general", 1], ["group-8", 1]]);
  assert.equal(inactive.ok, false);
  assert.match(inactive.error, /^unavailable:group-8/);
  const soldOutEarly = await (async () => {
    await pool.query("update tiers set active = false where event_id = $1 and tier_id = 'early-bird'", [EVENT]);
    return reserveCart([["general", 1], ["early-bird", 1]]);
  })();
  assert.equal(soldOutEarly.ok, false);
  assert.match(soldOutEarly.error, /^unavailable:early-bird/);
  for (const name of ["vip", "complimentary"]) {
    const res = await reserveCart([["general", 1]]).then(async () => {
      try {
        await pool.query("select * from reserve_cart($1, $2::jsonb, $3, '{}'::jsonb, 'usd', 100)", [
          EVENT,
          JSON.stringify([{ tier_id: "general", quantity: 1 }, { tier_id: name, quantity: 1 }]),
          key(),
        ]);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    assert.equal(res.ok, false, `${name} was held`);
    assert.match(res.error, new RegExp(`unavailable:${name}`));
  }
  assert.equal(await heldBy("general"), 2, "only the two successful single-line holds remain");
  await assertInvariants("rollback");
});

test(`mixed cart and single-ticket hold race for the same last Female, ${ROUNDS} rounds`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ female: 1 });
    const [cart, legacy] = await Promise.all([reserveCart([["female", 1], ["couple", 1]]), reserveLegacy("female", 1)]);
    assert.equal([cart, legacy].filter((r) => r.ok).length, 1, `round ${round}: both held the last Female`);
    assert.equal(await heldBy("couple"), cart.ok ? 1 : 0, `round ${round}: Couple held without its cart`);
    await assertInvariants(`legacy round ${round}`);
  }
});

test("hold expiry releases every line of a mixed cart at once", async () => {
  await seed({ female: 1, couple: 1 });
  const held = await reserveCart([["female", 1], ["couple", 1]]);
  assert.ok(held.ok);
  assert.equal(await heldBy("female"), 1);
  assert.equal(await heldBy("couple"), 1);
  assert.equal((await reserveCart([["female", 1]])).ok, false, "a second buyer must wait while the hold is live");

  // Expiry is one column on one row; both lines read it, so they cannot expire separately.
  await pool.query("update checkout_holds set expires_at = now() - interval '1 second' where id = $1", [held.hold_id]);
  assert.equal(await heldBy("female"), 0);
  assert.equal(await heldBy("couple"), 0);
  const holds = (await pool.query("select * from event_holds($1)", [EVENT])).rows;
  assert.deepEqual(holds, []);

  const next = await reserveCart([["couple", 1], ["female", 1]]);
  assert.ok(next.ok, next.error);
  // Re-using the expired cart's key replaces its hold and items; nothing of the old hold survives.
  await pool.query("update checkout_holds set expires_at = now() - interval '1 second' where id = $1", [next.hold_id]);
  const again = await reserveCart([["couple", 1], ["female", 1]], { idem: next.idem });
  assert.ok(again.ok, again.error);
  assert.notEqual(again.hold_id, next.hold_id);
  assert.equal((await pool.query("select count(*)::int as n from checkout_hold_items where hold_id = $1", [next.hold_id])).rows[0].n, 0);
  assert.equal(await heldBy("female"), 1);
  assert.equal(await heldBy("couple"), 1);
  await assertInvariants("expiry");
});

async function buy(items, promo = null) {
  const res = await reserveCart(items, { promo });
  assert.ok(res.ok, res.error);
  const pi = `pi_race_${res.idem.slice(-8)}`;
  await pool.query("update checkout_carts set payment_intent_id = $1 where id = $2", [pi, res.cart_id]);
  await pool.query("update checkout_holds set payment_intent_id = $1 where id = $2", [pi, res.hold_id]);
  return { res, pi };
}

const fulfilCart = (pi, cartId, amount) =>
  pool.query("select * from create_cart_order($1, $1, $2::uuid, 'Race Buyer', 'race@example.com', $3, 'usd')", [pi, cartId, amount]).then((r) => r.rows[0]);

test(`concurrent webhook replays of one mixed payment create one order, ${ROUNDS} rounds`, { timeout: 120000 }, async () => {
  for (let round = 1; round <= ROUNDS; round += 1) {
    await seed({ female: 3, general: 3, group: 2 });
    const { res, pi } = await buy([["female", 1], ["general", 1], ["group", 1]], GISO15);
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => fulfilCart(pi, res.cart_id, res.snapshot.total)));
    assert.equal(outcomes.filter((o) => o.outcome === "created").length, 1, `round ${round}: ${outcomes.map((o) => o.outcome)}`);
    assert.ok(outcomes.every((o) => o.order_id === outcomes[0].order_id));
    const counts = (await pool.query(
      "select (select count(*) from orders)::int as orders, (select count(*) from order_items)::int as items, (select count(*) from tickets)::int as tickets, (select count(distinct token) from tickets)::int as tokens",
    )).rows[0];
    assert.deepEqual(counts, { orders: 1, items: 3, tickets: 7, tokens: 7 });
    assert.equal((await pool.query("select tier_sold($1,'female') as f, tier_sold($1,'general') as m, tier_sold($1,'group') as g", [EVENT])).rows[0].g, 1);
    assert.equal(await heldBy("group"), 0, "the hold is released once the order exists");
    await assertInvariants(`replay round ${round}`);
  }
});

test("Female + Male + Group of 5 issues 7 typed passes with unique secure tokens", async () => {
  await seed({});
  const { res, pi } = await buy([["female", 1], ["general", 1], ["group", 1]]);
  const out = await fulfilCart(pi, res.cart_id, res.snapshot.total);
  assert.equal(out.outcome, "created");
  const tickets = (await pool.query("select tier_id, guest_number, token from tickets where order_id = $1 order by guest_number", [out.order_id])).rows;
  assert.equal(tickets.length, 7);
  assert.deepEqual(tickets.map((t) => t.tier_id), ["female", "general", "group", "group", "group", "group", "group"]);
  assert.deepEqual(tickets.map((t) => t.guest_number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(tickets.map((t) => t.token)).size, 7);
  assert.ok(tickets.every((t) => typeof t.token === "string" && t.token.length >= 32), "tokens come from pgcrypto random bytes");
  const items = (await pool.query("select * from order_items where order_id = $1 order by position", [out.order_id])).rows;
  assert.deepEqual(
    items.map((i) => [i.tier_id, i.display_name_snapshot, i.unit_price_cents, i.quantity, i.admissions_per_unit, i.total_admissions]),
    [["female", "Female", 1799, 1, 1, 1], ["general", "Male", 1999, 1, 1, 1], ["group", "Group of 5", 8999, 1, 5, 5]],
  );
  // A later price change does not touch what this order bought.
  await pool.query("update tiers set price_cents = 9999 where event_id = $1 and tier_id = 'female'", [EVENT]);
  assert.equal((await pool.query("select unit_price_cents from order_items where order_id = $1 and tier_id = 'female'", [out.order_id])).rows[0].unit_price_cents, 1799);
  await assert.rejects(pool.query("update order_items set unit_price_cents = 1 where order_id = $1", [out.order_id]), /order_items_immutable/);
});

test("GISO15 on Female x1 + Male x2 + Couple x1 is frozen as -$2.70, -$6.00, $0", async () => {
  await seed({});
  const { res, pi } = await buy([["female", 1], ["general", 2], ["couple", 1]], GISO15);
  const out = await fulfilCart(pi, res.cart_id, res.snapshot.total);
  assert.equal(out.outcome, "created");
  const items = (await pool.query("select tier_id, promo_eligible, eligible_discount_cents from order_items where order_id = $1 order by position", [out.order_id])).rows;
  assert.deepEqual(items, [
    { tier_id: "female", promo_eligible: true, eligible_discount_cents: 270 },
    { tier_id: "general", promo_eligible: true, eligible_discount_cents: 600 },
    { tier_id: "couple", promo_eligible: false, eligible_discount_cents: 0 },
  ]);
  const order = (await pool.query("select promo_code, discount_amount_cents, original_subtotal_cents from orders where id = $1", [out.order_id])).rows[0];
  assert.deepEqual(order, { promo_code: "GISO15", discount_amount_cents: 870, original_subtotal_cents: 1799 + 3998 + 2999 });
});

test("a full refund cancels every pass, restores every line once, and keeps the snapshot", async () => {
  await seed({ female: 2, couple: 2 });
  const { res, pi } = await buy([["female", 1], ["couple", 1]], GISO15);
  const out = await fulfilCart(pi, res.cart_id, res.snapshot.total);
  assert.equal(out.outcome, "created");
  const sold = async () => (await pool.query("select tier_sold($1,'female') as f, tier_sold($1,'couple') as c", [EVENT])).rows[0];
  assert.deepEqual(await sold(), { f: 1, c: 1 });

  const [first, second] = await Promise.all([
    pool.query("select cancel_order_by_payment_intent($1, true) as n", [pi]),
    pool.query("select cancel_order_by_payment_intent($1, true) as n", [pi]),
  ]);
  assert.equal(first.rows[0].n + second.rows[0].n, 3, "each of the 3 passes is cancelled exactly once");
  assert.deepEqual(await sold(), { f: 0, c: 0 });
  const tickets = (await pool.query("select status from tickets where order_id = $1", [out.order_id])).rows;
  assert.ok(tickets.every((t) => t.status === "cancelled"));
  const after = (await pool.query("select status, promo_code, discount_amount_cents from orders where id = $1", [out.order_id])).rows[0];
  assert.deepEqual(after, { status: "refunded", promo_code: "GISO15", discount_amount_cents: 270 });
  assert.equal((await pool.query("select count(*)::int as n from order_items where order_id = $1", [out.order_id])).rows[0].n, 2);
  assert.equal((await pool.query("select count(*)::int as n from checkout_holds")).rows[0].n, 0);
  // Inventory is back: the same two units can be bought again.
  assert.ok((await reserveCart([["female", 2], ["couple", 2]])).ok);
  await assertInvariants("refund");
});

test("each pass of a mixed order scans once, then reads as already used", async () => {
  await seed({});
  const { res, pi } = await buy([["female", 1], ["couple", 1]]);
  const out = await fulfilCart(pi, res.cart_id, res.snapshot.total);
  const tickets = (await pool.query("select token, tier_id from tickets where order_id = $1 order by guest_number", [out.order_id])).rows;
  for (const ticket of tickets) {
    const firstScan = (await pool.query("select * from check_in_ticket($1, $2, 'door', 'race')", [ticket.token, EVENT])).rows[0];
    assert.equal(firstScan.outcome, "admitted");
    assert.equal(firstScan.tier_name, ticket.tier_id === "female" ? "Female" : "Couple");
    const secondScan = (await pool.query("select * from check_in_ticket($1, $2, 'door', 'race')", [ticket.token, EVENT])).rows[0];
    assert.equal(secondScan.outcome, "already-used");
  }
});
