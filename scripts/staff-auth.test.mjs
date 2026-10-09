import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAssignRole,
  canUseScanner,
  permit,
  privilegedVerification,
  rateLimitAllows,
  requiresMfa,
  resolveRole,
  roleAuditAction,
  sanitizeAuditSummary,
} from "../supabase/functions/_shared/staff-auth.mjs";

const adminSource = readFileSync(new URL("../supabase/functions/admin/index.ts", import.meta.url), "utf8");

test("unknown and client-supplied roles are not authoritative", () => {
  assert.equal(resolveRole("super_admin"), "super_admin");
  assert.equal(resolveRole("owner"), null);
  assert.equal(resolveRole("super_admin "), null);
  assert.equal(permit("owner", "overview"), false);
  assert.equal(permit(null, "staff_set"), false);
});

test("permission matrix denies door staff and limits admins", () => {
  for (const action of ["overview", "orders", "refund_one", "cancel_confirm", "staff_set", "audit"]) {
    assert.equal(permit("door_staff", action), false, action);
  }
  assert.equal(permit("admin", "overview"), true);
  assert.equal(permit("admin", "orders"), true);
  assert.equal(permit("admin", "audit"), true);
  assert.equal(permit("admin", "staff_list"), false);
  assert.equal(permit("admin", "staff_set"), false);
  assert.equal(permit("super_admin", "staff_set"), true);
  assert.equal(permit("super_admin", "refund_one"), true);
});

test("privileged roles require authenticator MFA and door staff are outside this API", () => {
  assert.equal(requiresMfa("super_admin"), true);
  assert.equal(requiresMfa("admin"), true);
  assert.equal(requiresMfa("door_staff"), false);
  assert.match(adminSource, /requiresMfa\(actor\.role\)/);
  assert.match(adminSource, /aal2/);
  assert.doesNotMatch(adminSource, /PASSWORD_FAILED/);
  assert.doesNotMatch(adminSource, /ADMIN_EMAILS/);
});

test("an admin cannot promote itself or anyone else", () => {
  assert.equal(
    canAssignRole({
      actorId: "admin-1",
      actorRole: "admin",
      targetId: "admin-1",
      currentRole: "admin",
      nextRole: "super_admin",
      superAdminCount: 1,
    }),
    "Not authorised",
  );
  assert.equal(
    canAssignRole({
      actorId: "super-1",
      actorRole: "super_admin",
      targetId: "super-1",
      currentRole: "super_admin",
      nextRole: "admin",
      superAdminCount: 2,
    }),
    "You cannot change your own role.",
  );
});

test("scanner access is server-side and admin scanning requires MFA", () => {
  assert.equal(canUseScanner({ role: null, aal: "aal1", legacyDoor: true }), true);
  assert.equal(canUseScanner({ role: "admin", aal: "aal1", legacyDoor: false }), false);
  assert.equal(canUseScanner({ role: "admin", aal: "aal2", legacyDoor: false }), true);
  assert.equal(canUseScanner({ role: "super_admin", aal: "aal2", legacyDoor: false }), true);
  assert.equal(canUseScanner({ role: "door_staff", aal: "aal1", legacyDoor: false }), true);
  assert.equal(canUseScanner({ role: null, aal: "aal2", legacyDoor: false }), false);
  assert.equal(permit("admin", "scan"), true);
  assert.equal(permit("door_staff", "overview"), false);
});

test("a super admin role cannot be created or edited through ordinary role assignment", () => {
  assert.equal(
    canAssignRole({
      actorId: "super-1",
      actorRole: "super_admin",
      targetId: "super-2",
      currentRole: "super_admin",
      nextRole: "admin",
      superAdminCount: 1,
    }),
    "A super admin role cannot be changed here.",
  );
  assert.equal(
    canAssignRole({
      actorId: "super-1",
      actorRole: "super_admin",
      targetId: "user-9",
      currentRole: null,
      nextRole: "super_admin",
      superAdminCount: 1,
    }),
    "Super admin is assigned only through the one-time bootstrap.",
  );
  assert.equal(
    canAssignRole({
      actorId: "super-1",
      actorRole: "super_admin",
      targetId: "user-2",
      currentRole: null,
      nextRole: "door_staff",
      superAdminCount: 1,
    }),
    null,
  );
});

test("anonymous callers have no privileged action", () => {
  assert.equal(permit(null, "overview"), false);
  assert.match(adminSource, /Sign in required/);
});

test("audit metadata drops credentials and keeps a safe email", () => {
  const clean = sanitizeAuditSummary({
    email: "staff@example.com",
    password: "secret-value",
    access_token: "jwt",
    refresh_token: "refresh",
    totp: "123456",
    note: "role update",
  });
  assert.deepEqual(clean, { email: "staff@example.com", note: "role update" });
  assert.equal(roleAuditAction(null), "STAFF_ROLE_ASSIGNED");
  assert.equal(roleAuditAction("admin"), "STAFF_ROLE_CHANGED");
  assert.match(adminSource, /AUTH_ATTEMPT_FAILED/);
  const door = readFileSync(new URL("../supabase/functions/door/index.ts", import.meta.url), "utf8");
  assert.match(door, /canUseScanner/);
  assert.match(door, /DOOR_EMAILS/);
});

test("privileged verification requires the server role and aal2", () => {
  assert.equal(privilegedVerification({ authenticated: false, role: "super_admin", aal: "aal2", legacyDoor: false }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: "super_admin", aal: "aal1", legacyDoor: false }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: "admin", aal: "aal1", legacyDoor: false }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: null, aal: "aal2", legacyDoor: false }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: "door_staff", aal: "aal2", legacyDoor: false }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: "admin", aal: "aal2", legacyDoor: true }), false);
  assert.equal(privilegedVerification({ authenticated: true, role: "super_admin", aal: "aal2", legacyDoor: false }), true);
  assert.equal(privilegedVerification({ authenticated: true, role: "admin", aal: "aal2", legacyDoor: false }), true);
});

test("privileged auth rate limits fail closed when the limiter errors", () => {
  assert.equal(rateLimitAllows({ message: "down" }, true), false);
  assert.equal(rateLimitAllows(null, false), false);
  assert.equal(rateLimitAllows(null, true), true);
});
