// Source and pure-function checks for admin ticket operations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { complimentaryIssuanceStatus, cashReceivedPhraseOk, cashReturnedPhraseOk } from "../supabase/functions/_shared/admin-read.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const admin = read("../supabase/functions/admin/index.ts");
const migration = read("../supabase/migrations/20261109000000_admin_ticket_operations.sql");

test("complimentary issuance status is derived from the passes", () => {
  const pass = (status) => ({ status });
  assert.equal(complimentaryIssuanceStatus([pass("valid"), pass("valid"), pass("valid")]), "Active");
  assert.equal(complimentaryIssuanceStatus([pass("valid"), pass("checked-in"), pass("valid")]), "Partially used");
  assert.equal(complimentaryIssuanceStatus([pass("checked-in"), pass("checked-in")]), "Fully used");
  assert.equal(complimentaryIssuanceStatus([pass("valid"), pass("revoked"), pass("checked-in")]), "Partially revoked");
  assert.equal(complimentaryIssuanceStatus([pass("checked-in"), pass("revoked"), pass("revoked")]), "Partially revoked");
  assert.equal(complimentaryIssuanceStatus([pass("revoked"), pass("revoked")]), "Revoked");
  const counts = { issued: 5, used: 2, valid: 1, revoked: 2 };
  assert.equal(counts.issued, counts.used + counts.valid + counts.revoked);
});

test("cash confirmation phrases are exact", () => {
  assert.equal(cashReceivedPhraseOk("CASH RECEIVED"), true);
  assert.equal(cashReceivedPhraseOk("cash received"), false);
  assert.equal(cashReturnedPhraseOk("I confirm the cash amount has been returned to the customer."), true);
  assert.equal(cashReturnedPhraseOk("I confirm the cash amount has been returned."), false);
});

test("cash issuance quotes tax and never creates a Stripe charge", () => {
  const cash = admin.slice(admin.indexOf("async function priceCashSale"), admin.indexOf("async function cashRefund"));
  assert.match(cash, /quoteCartTotal/);
  assert.doesNotMatch(cash, /paymentIntents|checkout\.sessions|refunds\.create|stripe\.charges/);
  assert.match(admin, /CASH_SALE_ISSUED/);
  assert.match(admin, /CASH_SALE_REFUNDED/);
  assert.match(admin, /CASH REFUND NOT AVAILABLE/);
  const refundSql = migration.slice(migration.indexOf("function public.refund_cash_order"), migration.indexOf("function public.check_in_ticket"));
  assert.match(refundSql, /status = 'checked-in'/);
  assert.match(refundSql, /'admitted'/);
  assert.match(admin, /COMPLIMENTARY_PASS_REVOKED/);
  assert.match(admin, /COMPLIMENTARY_ISSUANCE_REVOKED/);
  assert.match(migration, /payment_method = 'cash'/);
  assert.match(migration, /stripe_payment_intent is null/);
  assert.doesNotMatch(migration, /stripe\.refunds|payment_intent_id/);
});

test("a revoked scan is its own result and a used pass is not rewritten", () => {
  assert.match(migration, /when v_ticket\.status = 'revoked' then 'revoked'/);
  assert.match(migration, /v_ticket\.status = 'checked-in'/);
  assert.match(migration, /status = 'valid'/);
  const door = read("../src/components/door/DoorApp.tsx");
  assert.match(door, /REVOKED/);
  assert.match(door, /This pass is no longer valid/);
  assert.match(door, /Complimentary admission/);
  assert.match(door, /complimentary && result\.outcome === "admitted" \? "Used"/);
});

test("the public site has no cash-sale or complimentary-revoke controls", () => {
  const roots = ["../src/app", "../src/components"];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "admin" || entry.name === "door") continue;
        walk(next);
      } else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) files.push(next);
    }
  };
  roots.forEach(walk);
  const publicSource = files.map((file) => read(file)).join("\n");
  assert.doesNotMatch(publicSource, /Cash sale|Revoke pass|Revoke remaining|CONFIRM CASH|cash_issue|revoke_complimentary/);
});

test("resend keeps only currently valid complimentary passes", () => {
  const delivery = read("../supabase/functions/_shared/complimentary-delivery.ts");
  assert.match(delivery, /ticket\.status === "valid"/);
  assert.match(delivery, /none_valid/);
  assert.doesNotMatch(delivery, /insert into tickets|from\("tickets"\)\.insert/);
  assert.match(admin, /This invitation has no valid remaining passes/);
});
