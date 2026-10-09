import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { permit } from "../supabase/functions/_shared/staff-auth.mjs";
import {
  BLOCKED_ACTIONS,
  checkInPercent,
  cleanSearch,
  displayScanResult,
  displayTicketStatus,
  isBlockedAction,
  isLegacyDoorAccount,
  isOpenMutation,
  isReadAction,
  parseStaffEmail,
  parseStaffRole,
  refundBlockReason,
  refundPhraseOk,
  likePattern,
  orderRefFromId,
  parseEventId,
  parseOrderRef,
  parsePage,
  parseTicketRef,
  redactAudit,
  safeResource,
  splitCharge,
} from "../supabase/functions/_shared/admin-read.mjs";

const adminSource = readFileSync(new URL("../supabase/functions/admin/index.ts", import.meta.url), "utf8");
const clientSource = [
  "src/components/admin/admin-api.ts",
  "src/components/admin/AdminShell.tsx",
  "src/components/admin/OrdersPanel.tsx",
  "src/components/admin/OverviewPanel.tsx",
  "src/components/admin/RefundsPanel.tsx",
  "src/components/admin/StaffPanel.tsx",
  "src/app/admin/refunds/page.tsx",
  "src/app/admin/staff/page.tsx",
].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");

test("cancellation stays blocked while refunds and staff are open to the server role", () => {
  for (const action of BLOCKED_ACTIONS) {
    assert.equal(isBlockedAction(action), true, action);
    assert.equal(isReadAction(action), false, action);
    assert.equal(isOpenMutation(action), false, action);
  }
  for (const action of ["refund_preview", "refund_one", "staff_list", "staff_set"]) {
    assert.equal(isBlockedAction(action), false, action);
    assert.equal(isOpenMutation(action), true, action);
  }
  assert.equal(permit("super_admin", "refund_one"), true);
  assert.equal(permit("admin", "staff_set"), false);
  assert.match(adminSource, /isBlockedAction\(action\)/);
  assert.match(adminSource, /not available/);
  assert.match(adminSource, /case "refund_one"/);
  assert.match(adminSource, /case "staff_set"/);
  assert.match(adminSource, /stripe\.refunds/);
  assert.match(adminSource, /refundPhraseOk\(body\.confirm\)/);
  assert.doesNotMatch(adminSource, /case "cancel_confirm"/);
  assert.doesNotMatch(adminSource, /access_token/);
  assert.doesNotMatch(adminSource, /body\.role/);
  assert.doesNotMatch(adminSource, /body\.eventName/);
});

test("a super admin can refund a paid charge and an admin cannot until the event is cancelled", () => {
  assert.equal(refundPhraseOk("REFUND"), true);
  assert.equal(refundPhraseOk("refund"), false);
  assert.equal(refundBlockReason({ role: "super_admin", eventStatus: "open", orderStatus: "paid", charged: true }), null);
  assert.equal(
    refundBlockReason({ role: "admin", eventStatus: "open", orderStatus: "paid", charged: true }),
    "An admin can refund only after the event is cancelled.",
  );
  assert.equal(refundBlockReason({ role: "admin", eventStatus: "cancelled", orderStatus: "paid", charged: true }), null);
  assert.equal(refundBlockReason({ role: "super_admin", eventStatus: "open", orderStatus: "paid", charged: false }), "This order has no card charge to refund.");
  assert.equal(refundBlockReason({ role: "super_admin", eventStatus: "open", orderStatus: "refunded", charged: true }), "This order already has a refund.");
  assert.equal(parseStaffEmail(" Staff@Example.com "), "staff@example.com");
  assert.equal(parseStaffEmail("not an email"), null);
  assert.equal(parseStaffRole("admin"), "admin");
  assert.equal(parseStaffRole("door_staff"), "door_staff");
  assert.equal(parseStaffRole("super_admin"), null);
  assert.equal(parseStaffRole("remove"), "remove");
});

test("read actions stay on the server role, not a client role", () => {
  for (const action of ["overview", "events", "orders", "order", "tickets", "ticket", "checkin", "sales", "audit"]) {
    assert.equal(permit("admin", action), true, action);
    assert.equal(permit("super_admin", action), true, action);
    assert.equal(permit("door_staff", action), false, action);
    assert.equal(permit("owner", action), false, action);
  }
  assert.match(adminSource, /staff_roles/);
  assert.match(adminSource, /requiresMfa\(actor\.role\)/);
  assert.match(adminSource, /aal2/);
  assert.match(adminSource, /isLegacyDoorAccount/);
});

test("the legacy door account is never an admin account", () => {
  assert.equal(isLegacyDoorAccount("door@theonemorecompany.com"), true);
  assert.equal(isLegacyDoorAccount(" Door@TheOneMoreCompany.com "), true);
  assert.equal(isLegacyDoorAccount("admin@theonemorecompany.com", "door@theonemorecompany.com"), false);
  assert.equal(isLegacyDoorAccount("guest@example.com", "guest@example.com"), true);
  assert.equal(isLegacyDoorAccount("admin@theonemorecompany.com"), false);
});

test("Houston early bird tax is split from stored cents", () => {
  assert.deepEqual(splitCharge(1623, 1499, 1), { subtotal: 1499, tax: 124, total: 1623 });
  assert.equal(splitCharge(100, 1499, 1), null);
  assert.equal(checkInPercent(0, 0), null);
  assert.equal(checkInPercent(1, 4), 25);
});

test("search and identifiers reject injection and raw secrets", () => {
  assert.equal(cleanSearch("Ada Lovelace"), "Ada Lovelace");
  assert.equal(cleanSearch("a' or 1=1 --"), null);
  assert.equal(cleanSearch("name),role.eq.super_admin"), null);
  assert.equal(likePattern("a_b%"), "%a\\_b\\%%");
  assert.equal(parseEventId("evt_diwali_night';drop"), null);
  assert.equal(parsePage("1;select", 25), null);
  assert.equal(parsePage(1, 25)?.pageSize, 25);
  assert.equal(parsePage(1, 10), null);
  const id = "6b461729-1111-4111-8111-111111111111";
  assert.equal(orderRefFromId(id), "OMC-6B461729");
  assert.equal(parseOrderRef("OMC-6B461729"), "6b461729");
  assert.equal(parseOrderRef(id), null);
  assert.equal(parseTicketRef("T-6B461729"), "6b461729");
  assert.equal(safeResource("order", id), "OMC-6B461729");
  assert.deepEqual(redactAudit({ email: "a@b.co", access_token: "jwt", password: "x", note: "ok" }), { email: "a@b.co", note: "ok" });
  assert.deepEqual(redactAudit({ note: "aaaa.bbbb.cccc" }), {});
});

test("pass and scan labels do not invent a status", () => {
  assert.equal(displayTicketStatus("valid", "paid"), "VALID");
  assert.equal(displayTicketStatus("checked-in", "paid"), "CHECKED IN");
  assert.equal(displayTicketStatus("cancelled", "paid"), "CANCELLED");
  assert.equal(displayTicketStatus("cancelled", "refunded"), "REFUNDED");
  assert.equal(displayScanResult("admitted", "paid"), "CHECKED IN");
  assert.equal(displayScanResult("already-used", "paid"), "ALREADY USED");
  assert.equal(displayScanResult("not-found", ""), "INVALID");
  assert.equal(displayScanResult("cancelled", "refunded"), "REFUNDED");
  assert.equal(displayScanResult("wrong-event", "paid"), "INVALID");
});

test("test orders stay out of every admin read", () => {
  const orderReads = adminSource.match(/\.from\("orders"\)[\s\S]*?;/g) ?? [];
  for (const read of orderReads) {
    if (read.includes("limit(0)")) continue;
    assert.match(read, /is_test/, read.slice(0, 80));
  }
  assert.match(adminSource, /orders\.is_test", false/);
  assert.match(adminSource, /!orderOf\(row\)\?\.is_test/);
});

test("the operations UI refunds and assigns staff without the blocked actions", () => {
  for (const action of ["cancel_confirm", "pause_sales", "resume_sales", "resend", "alerts"]) {
    assert.equal(clientSource.includes(`"${action}"`), false, action);
  }
  assert.match(clientSource, /"refund_one"/);
  assert.match(clientSource, /"staff_set"/);
  assert.match(clientSource, /"staff_list"/);
  assert.doesNotMatch(clientSource, /value="super_admin"/);
  assert.match(clientSource, /Scanner access — verify/);
  assert.doesNotMatch(clientSource, /Refunds are disabled/);
  assert.doesNotMatch(clientSource, /Staff management is disabled/);
});
