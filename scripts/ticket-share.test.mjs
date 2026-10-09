import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { passStanding } from "../src/lib/pass-standing.ts";

const shareSource = readFileSync(new URL("../supabase/functions/ticket-share/index.ts", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../supabase/functions/ticket-view/index.ts", import.meta.url), "utf8");
const doorSource = readFileSync(new URL("../supabase/functions/door/index.ts", import.meta.url), "utf8");

test("cancelled and refunded passes read INVALID, and a used pass reads ALREADY USED", () => {
  assert.equal(passStanding("valid", "paid"), "VALID");
  assert.equal(passStanding("cancelled", "paid"), "INVALID");
  assert.equal(passStanding("valid", "refunded"), "INVALID");
  assert.equal(passStanding("cancelled", "refunded"), "INVALID");
  assert.equal(passStanding("checked-in", "paid"), "ALREADY USED");
  assert.equal(passStanding("checked-in", "refunded"), "ALREADY USED");
});

test("a share token is separate from the admission QR and only its hash is stored", () => {
  const admission = randomBytes(18).toString("hex");
  const share = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(share).digest("hex");
  assert.equal(admission.length, 36);
  assert.equal(share.length, 64);
  assert.equal(hash.length, 64);
  assert.notEqual(share, admission);
  assert.notEqual(hash, share);
  assert.match(shareSource, /token_hash: await sha256\(token\)/);
  assert.match(shareSource, /crypto\.getRandomValues/);
  assert.match(shareSource, /new Uint8Array\(32\)/);
  assert.match(shareSource, /revoked_at: new Date/);
  assert.match(shareSource, /\/tickets\/shared#/);
  assert.match(shareSource, /body\.action === "read"/);
  assert.match(shareSource, /if \(error \|\| data !== true\) return false/);
  assert.doesNotMatch(shareSource, /\?t=/);
  assert.doesNotMatch(shareSource, /console\.(log|error|info)/);
  assert.match(doorSource, /TOKEN_RE = \/\^\[0-9a-f\]\{36\}\$/);
  assert.equal(/^[0-9a-f]{36}$/.test(share), false);
  assert.doesNotMatch(shareSource, /stripe_|purchaser_email/);
  assert.doesNotMatch(viewSource, /stripe_payment_intent|purchaser_email/);
  assert.match(viewSource, /purchaser_name: data\.purchaser_name/);
  const sharedPage = readFileSync(new URL("../src/app/tickets/shared/page.tsx", import.meta.url), "utf8");
  assert.match(sharedPage, /history\.replaceState/);
  assert.match(sharedPage, /action: "read"/);
  assert.doesNotMatch(sharedPage, /\?t=/);
});

const PROJECT = "curprrfrkefegefqiign";
const QA_EVENT = "evt_qa_stagec";
const live = process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_PROJECT_REF?.trim() === PROJECT;

test("qa ticket shares stay off customer inventory", { skip: !live }, async () => {
  const key = process.env.SUPABASE_SECRET_KEY;
  const base = `https://${PROJECT}.supabase.co`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const publishable = readFileSync(new URL("../src/data/backend.ts", import.meta.url), "utf8").match(/supabaseKey:\s*"([^"]+)"/)[1];

  async function rest(path, method, body, prefer) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`qa ${method} ${res.status}`);
    return text ? JSON.parse(text) : null;
  }

  async function count(table, filter) {
    const res = await fetch(`${base}/rest/v1/${table}?${filter}&select=id`, {
      headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
    });
    return Number(res.headers.get("content-range")?.split("/")[1]);
  }

  async function removeQa() {
    const orders = await rest(`orders?event_id=eq.${QA_EVENT}&select=id`, "GET");
    const orderIds = (orders ?? []).map((row) => row.id);
    if (!orderIds.length) return;
    const list = orderIds.join(",");
    const tickets = await rest(`tickets?order_id=in.(${list})&select=id`, "GET");
    const ticketIds = (tickets ?? []).map((row) => row.id);
    if (ticketIds.length) {
      await rest(`ticket_shares?ticket_id=in.(${ticketIds.join(",")})`, "DELETE");
      await rest(`scans?ticket_id=in.(${ticketIds.join(",")})`, "DELETE");
      await rest(`tickets?id=in.(${ticketIds.join(",")})`, "DELETE");
    }
    await rest(`orders?id=in.(${list})`, "DELETE");
  }

  const before = {
    orders: await count("orders", "event_id=eq.evt_diwali_night"),
    tickets: await count("tickets", "event_id=eq.evt_diwali_night"),
    scans: await count("scans", "id=not.is.null"),
  };
  assert.deepEqual(before, { orders: 17, tickets: 24, scans: 3 });
  await removeQa();

  try {
    const paid = await rest("orders", "POST", {
      stripe_session_id: `qa-stagec-${randomBytes(8).toString("hex")}`,
      stripe_payment_intent: `qa-pi-${randomBytes(8).toString("hex")}`,
      event_id: QA_EVENT,
      tier_id: "qa-stagec",
      tier_name: "QA",
      quantity: 4,
      purchaser_name: "QA STAGE C",
      purchaser_email: "qa-stagec@example.invalid",
      amount_total: 0,
      currency: "usd",
      status: "paid",
    }, "return=representation");
    const refunded = await rest("orders", "POST", {
      stripe_session_id: `qa-stagec-${randomBytes(8).toString("hex")}`,
      stripe_payment_intent: `qa-pi-${randomBytes(8).toString("hex")}`,
      event_id: QA_EVENT,
      tier_id: "qa-stagec",
      tier_name: "QA",
      quantity: 1,
      purchaser_name: "QA STAGE C",
      purchaser_email: "qa-stagec@example.invalid",
      amount_total: 0,
      currency: "usd",
      status: "refunded",
    }, "return=representation");
    const paidId = paid[0].id;
    const refundedId = refunded[0].id;
    const admission = [randomBytes(18), randomBytes(18), randomBytes(18), randomBytes(18), randomBytes(18)].map((b) => b.toString("hex"));
    const checkedInAt = "2026-10-09T17:00:00.000Z";
    await rest("tickets", "POST", [
      { order_id: paidId, event_id: QA_EVENT, tier_id: "qa-stagec", guest_number: 1, token: admission[0], status: "valid", checked_in_at: null },
      { order_id: paidId, event_id: QA_EVENT, tier_id: "qa-stagec", guest_number: 2, token: admission[1], status: "valid", checked_in_at: null },
      { order_id: paidId, event_id: QA_EVENT, tier_id: "qa-stagec", guest_number: 3, token: admission[2], status: "cancelled", checked_in_at: null },
      { order_id: paidId, event_id: QA_EVENT, tier_id: "qa-stagec", guest_number: 4, token: admission[3], status: "checked-in", checked_in_at: checkedInAt },
      { order_id: refundedId, event_id: QA_EVENT, tier_id: "qa-stagec", guest_number: 1, token: admission[4], status: "cancelled", checked_in_at: null },
    ], "return=minimal");
    const tickets = await rest(`tickets?order_id=eq.${paidId}&select=id,guest_number,token,status&order=guest_number`, "GET");
    assert.equal(tickets.length, 4);

    const access = paid[0].access_token;
    const viewed = await fetch(`${base}/functions/v1/ticket-view?o=${access}`, {
      headers: { apikey: publishable, Authorization: `Bearer ${publishable}` },
    });
    const view = await viewed.json();
    assert.equal(viewed.status, 200);
    assert.equal(view.tickets.length, 4);
    const serialized = JSON.stringify(view);
    const allowedKeys = ["event_id", "tier_name", "purchaser_name", "status", "access_token", "tickets"];
    assert.deepEqual(Object.keys(view).sort(), [...allowedKeys].sort());
    assert.equal(view.purchaser_email, undefined);
    assert.equal(serialized.includes("@"), false);
    assert.equal(serialized.includes("qa-pi-"), false);
    assert.equal(serialized.includes("stripe_"), false);
    assert.equal(serialized.includes(paidId), false);
    assert.equal(view.id, undefined);
    for (const ticket of view.tickets) {
      assert.deepEqual(Object.keys(ticket).sort(), ["checked_in_at", "guest_number", "status", "token"].sort());
      assert.equal(ticket.id, undefined);
      assert.equal(ticket.order_id, undefined);
    }

    async function shareApi(payload) {
      const res = await fetch(`${base}/functions/v1/ticket-share`, {
        method: "POST",
        headers: {
          apikey: publishable,
          Authorization: `Bearer ${publishable}`,
          "Content-Type": "application/json",
          Origin: "https://theonemorecompany.com",
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }
    function shareToken(url) {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/tickets/shared");
      assert.equal(parsed.search, "");
      assert.match(parsed.hash, /^#[0-9a-f]{64}$/);
      return parsed.hash.slice(1);
    }

    const created = await shareApi({ action: "create", accessToken: access, guestNumber: 1 });
    assert.equal(created.status, 200);
    assert.equal(created.json.token, undefined);
    const firstToken = shareToken(created.json.url);
    const firstView = await shareApi({ action: "read", token: firstToken });
    assert.equal(firstView.status, 200);
    assert.equal(firstView.json.guestNumber, 1);
    assert.equal(firstView.json.admissionCode, tickets[0].token);
    assert.equal(firstView.json.purchaser_email, undefined);
    assert.equal(JSON.stringify(firstView.json).includes(paidId), false);
    assert.equal(JSON.stringify(firstView.json).includes("stripe"), false);

    const second = await shareApi({ action: "create", accessToken: access, guestNumber: 2 });
    const secondToken = shareToken(second.json.url);
    assert.notEqual(secondToken, firstToken);
    const secondView = await shareApi({ action: "read", token: secondToken });
    assert.equal(secondView.json.guestNumber, 2);
    assert.equal(JSON.stringify(secondView.json).includes(tickets[0].token), false);

    const rotated = await shareApi({ action: "create", accessToken: access, guestNumber: 1 });
    const rotatedToken = shareToken(rotated.json.url);
    assert.notEqual(rotatedToken, firstToken);
    assert.equal((await shareApi({ action: "read", token: firstToken })).status, 404);
    const rotatedView = await shareApi({ action: "read", token: rotatedToken });
    assert.equal(rotatedView.json.admissionCode, tickets[0].token);

    const hashes = await rest(`ticket_shares?ticket_id=eq.${tickets[0].id}&select=token_hash`, "GET");
    for (const row of hashes) {
      assert.notEqual(row.token_hash, firstToken);
      assert.notEqual(row.token_hash, rotatedToken);
    }

    assert.equal((await shareApi({ action: "revoke", accessToken: access, guestNumber: 1 })).status, 200);
    assert.equal((await shareApi({ action: "read", token: rotatedToken })).status, 404);
    const unchanged = await rest(`tickets?id=eq.${tickets[0].id}&select=status,token`, "GET");
    assert.equal(unchanged[0].status, "valid");
    assert.equal(unchanged[0].token, admission[0]);

    const cancelled = await shareApi({ action: "create", accessToken: access, guestNumber: 3 });
    const cancelledView = await shareApi({ action: "read", token: shareToken(cancelled.json.url) });
    assert.equal(passStanding(cancelledView.json.status, cancelledView.json.orderStatus), "INVALID");
    const used = await shareApi({ action: "create", accessToken: access, guestNumber: 4 });
    const usedView = await shareApi({ action: "read", token: shareToken(used.json.url) });
    assert.equal(passStanding(usedView.json.status, usedView.json.orderStatus), "ALREADY USED");
    assert.equal(Date.parse(usedView.json.checkedInAt), Date.parse(checkedInAt));
    const refundedShare = await shareApi({ action: "create", accessToken: refunded[0].access_token, guestNumber: 1 });
    const refundedView = await shareApi({ action: "read", token: shareToken(refundedShare.json.url) });
    assert.equal(passStanding(refundedView.json.status, refundedView.json.orderStatus), "INVALID");

    assert.equal((await shareApi({ action: "read", token: randomBytes(32).toString("hex") })).status, 404);
    const modified = `${secondToken.slice(0, -1)}${secondToken.endsWith("a") ? "b" : "a"}`;
    assert.equal((await shareApi({ action: "read", token: modified })).status, 404);
    assert.equal((await shareApi({ action: "read", token: "short" })).json.error, (await shareApi({ action: "read", token: randomBytes(32).toString("hex") })).json.error);
    const leakedGet = await fetch(`${base}/functions/v1/ticket-share?t=${secondToken}`, {
      headers: { apikey: publishable, Origin: "https://theonemorecompany.com" },
    });
    assert.equal(leakedGet.status, 404);

    const afterTickets = await count("tickets", `order_id=eq.${paidId}`);
    assert.equal(afterTickets, 4);
    assert.equal(passStanding("cancelled", "paid"), "INVALID");
    assert.equal(passStanding("cancelled", "refunded"), "INVALID");
    assert.equal(passStanding("checked-in", "paid"), "ALREADY USED");
  } finally {
    await removeQa();
    const after = {
      orders: await count("orders", "event_id=eq.evt_diwali_night"),
      tickets: await count("tickets", "event_id=eq.evt_diwali_night"),
      scans: await count("scans", "id=not.is.null"),
    };
    assert.deepEqual(after, before);
    assert.equal(await count("orders", `event_id=eq.${QA_EVENT}`), 0);
  }
});
