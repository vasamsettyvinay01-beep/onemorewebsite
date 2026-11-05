// Prints an md5 fingerprint of every public function after applying the repo migrations
// up to (and excluding) PARITY_BEFORE, so it can be compared with the same query on production.
//
//   RACE_DATABASE_URL=postgres://postgres:race@127.0.0.1:56543/postgres PARITY_BEFORE=20261108000000 node scripts/race/schema-parity.pg.mjs
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const ADMIN_URL = process.env.RACE_DATABASE_URL;
if (!ADMIN_URL) throw new Error("Set RACE_DATABASE_URL to a disposable local Postgres server.");
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(ADMIN_URL).hostname)) throw new Error("Refusing non-local host.");
const BEFORE = process.env.PARITY_BEFORE ?? "99999999999999";
const DB_NAME = `omc_parity_${Date.now()}`;
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`create database ${DB_NAME}`);
const url = new URL(ADMIN_URL);
url.pathname = `/${DB_NAME}`;
const db = new pg.Client({ connectionString: url.toString() });
try {
  await db.connect();
  await db.query(`
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
  `);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (file.slice(0, 14) >= BEFORE) continue;
    await db.query(readFileSync(new URL(file, MIGRATIONS), "utf8").replace("if v_count <> 17 then", "if false then"));
  }
  const { rows } = await db.query(readFileSync(new URL("./schema-fingerprint.sql", import.meta.url), "utf8"));
  console.log(JSON.stringify(rows, null, 1));
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.end();
}
