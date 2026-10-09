// Authoritative staff permissions. Roles come from staff_roles, never from the browser.
// Stage D deploys read actions only. Mutation actions stay in this matrix for a later
// confirmed release, and the admin function rejects them until then.

export const ROLES = ["super_admin", "admin", "door_staff"];

// Final matrix. Door operations stay on the existing door function.
// Admin cancellation and refunds are allowed only with the extra checks in the function:
// cancellation requires the event name and a reason; refunds require the word REFUND,
// and an admin can refund only after the event is cancelled.
export const PERMISSIONS = {
  whoami: ["super_admin", "admin"],
  overview: ["super_admin", "admin"],
  events: ["super_admin", "admin"],
  orders: ["super_admin", "admin"],
  order: ["super_admin", "admin"],
  tickets: ["super_admin", "admin"],
  ticket: ["super_admin", "admin"],
  checkin: ["super_admin", "admin"],
  sales: ["super_admin", "admin"],
  audit: ["super_admin", "admin"],
  pause_sales: ["super_admin", "admin"],
  resume_sales: ["super_admin", "admin"],
  cancel_preview: ["super_admin", "admin"],
  cancel_confirm: ["super_admin", "admin"],
  refund_preview: ["super_admin", "admin"],
  refund_one: ["super_admin", "admin"],
  resend: ["super_admin", "admin"],
  alerts: ["super_admin", "admin"],
  staff_list: ["super_admin"],
  staff_set: ["super_admin"],
  scan: ["super_admin", "admin", "door_staff"],
  admit: ["super_admin", "admin", "door_staff"],
  stats: ["super_admin", "admin", "door_staff"],
  search: ["super_admin", "admin", "door_staff"],
};

const SECRET_KEYS = new Set([
  "password",
  "secret",
  "mfa_secret",
  "otp",
  "totp",
  "code",
  "card",
  "pan",
  "share_token",
  "access_token",
  "refresh_token",
  "token_hash",
  "service_role_key",
  "authorization",
]);

export function resolveRole(value) {
  return ROLES.includes(value) ? value : null;
}

export function requiresMfa(role) {
  return role === "super_admin" || role === "admin";
}

// The legacy shared door login is authorized by its email, not by a role.
// Admin and super_admin may scan only after authenticator MFA (aal2).
export function canUseScanner({ role, aal, legacyDoor }) {
  if (legacyDoor) return true;
  if (role === "door_staff") return true;
  if ((role === "admin" || role === "super_admin") && aal === "aal2") return true;
  return false;
}

// Privileged admin verification. Role and assurance must already have been
// resolved by the server. Request-body roles are not an input.
export function privilegedVerification({ authenticated, role, aal, legacyDoor }) {
  if (!authenticated || legacyDoor) return false;
  if (role !== "super_admin" && role !== "admin") return false;
  return aal === "aal2";
}

export function permit(role, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed || !resolveRole(role)) return false;
  return allowed.includes(role);
}

export function canAssignRole({ actorId, actorRole, targetId, currentRole, nextRole, superAdminCount }) {
  if (actorRole !== "super_admin") return "Not authorised";
  if (!resolveRole(nextRole)) return "A valid email and role are required.";
  if (nextRole === "super_admin") return "Super admin is assigned only through the one-time bootstrap.";
  if (!actorId || actorId === targetId) return "You cannot change your own role.";
  if (currentRole === "super_admin") return "A super admin role cannot be changed here.";
  if (currentRole === "super_admin" && nextRole !== "super_admin" && superAdminCount <= 1) {
    return "The last super admin cannot be removed.";
  }
  return null;
}

export function roleAuditAction(currentRole) {
  return currentRole ? "STAFF_ROLE_CHANGED" : "STAFF_ROLE_ASSIGNED";
}

export function sanitizeAuditSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(summary)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 200);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) clean[key] = value;
  }
  return clean;
}

const READ_LIMITS = new Set([
  "whoami",
  "overview",
  "events",
  "orders",
  "order",
  "tickets",
  "ticket",
  "checkin",
  "sales",
  "audit",
]);

export function rateLimitFor(action) {
  if (action === "login_failed" || action === "staff_set" || action === "refund_one" || action === "cancel_confirm") {
    return { limit: action === "login_failed" ? 8 : 5, windowSeconds: 600 };
  }
  if (READ_LIMITS.has(action)) return { limit: 60, windowSeconds: 600 };
  return { limit: 30, windowSeconds: 600 };
}

// A limiter error denies the request. Privileged auth must not fail open.
export function rateLimitAllows(error, data) {
  if (error) return false;
  return data === true;
}
