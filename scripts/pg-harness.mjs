// Test helper: runs the real supabase/migrations against an in-memory Postgres
// (PGlite) so SQL behaviour is exercised, not just pattern-matched.
// Only the Supabase platform pieces the migrations assume are stubbed.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);

const PLATFORM_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists extensions;
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function extensions.gen_random_bytes(n int) returns bytea language sql as $$
    select decode(substr(md5(random()::text || clock_timestamp()::text) || md5(random()::text || n::text), 1, n * 2), 'hex')
  $$;
`;

// pgcrypto is not bundled with PGlite; extensions.gen_random_bytes above stands in for it.
// The 2026-10-09 data migration asserts 17 specific production rows; an empty test database has none.
const withoutExtensions = (sql) =>
  sql
    .replace(/create extension if not exists pgcrypto[^;]*;/gi, "")
    .replace("if v_count <> 17 then", "if false then");

/** Migrations strictly before `stopBefore` (a file-name prefix) are applied; null applies all. */
export async function openDatabase({ stopBefore = null, extraSql = "" } = {}) {
  const db = new PGlite();
  await db.exec(PLATFORM_STUBS);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (stopBefore && file >= stopBefore) break;
    const sql = withoutExtensions(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }
  if (extraSql) await db.exec(extraSql);
  return db;
}

export const EVENT = "evt_diwali_night";

/** The production tier list from src/data/events.ts, as stripe-setup writes it. */
export async function seedTiers(db, { earlyBirdSold = false } = {}) {
  await db.exec(`
    insert into tiers (event_id, tier_id, name, price_cents, currency, admits, capacity, max_per_order, active) values
      ('${EVENT}', 'early-bird', 'Early Bird', 1499, 'usd', 1, 10, 10, ${earlyBirdSold ? "false" : "true"}),
      ('${EVENT}', 'female', 'Female', 1799, 'usd', 1, null, 10, true),
      ('${EVENT}', 'general', 'Male', 1999, 'usd', 1, null, 10, true),
      ('${EVENT}', 'couple', 'Couple', 2999, 'usd', 2, null, 10, true),
      ('${EVENT}', 'group', 'Group of 5', 8999, 'usd', 5, null, 10, true),
      ('${EVENT}', 'group-8', 'Group of 8', 13999, 'usd', 8, null, 10, true)
    on conflict do nothing;
    insert into promotions (id, code, event_id, discount_type, discount_value, eligible_tier_ids)
    values ('8b0f3f8e-0000-4000-8000-000000000001', 'GISO15', '${EVENT}', 'percentage', 15, array['female', 'general'])
    on conflict do nothing;
  `);
}

export const GISO15_ID = "8b0f3f8e-0000-4000-8000-000000000001";
