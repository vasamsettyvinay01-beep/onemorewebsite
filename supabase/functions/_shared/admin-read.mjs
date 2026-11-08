// Pure helpers for the read-only admin API. No database access and no secrets.

export const LEGACY_DOOR_EMAIL = "door@theonemorecompany.com";

export const BLOCKED_ACTIONS = [
  "pause_sales",
  "resume_sales",
  "cancel_preview",
  "cancel_confirm",
  "resend",
  "alerts",
];

export const OPEN_MUTATIONS = [
  "refund_preview",
  "refund_one",
  "staff_list",
  "staff_set",
  "issue_complimentary",
  "resend_complimentary",
  "revoke_complimentary_pass",
  "revoke_complimentary_issuance",
  "cash_issue",
  "cash_refund",
  "vip_issue",
  "vip_resend",
  "vip_revoke",
];

export const READ_ACTIONS = [
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
  "complimentary_list",
  "complimentary_view",
  "complimentary_preview",
  "cash_quote",
  "promo_report",
  "vip_list",
  "vip_view",
  "vip_preview",
];

const PAYMENT_STATES = ["paid", "refunded", "partially-refunded", "disputed"];
const REFUND_STATES = ["none", "refunded", "partial", "disputed"];
const TICKET_FILTERS = ["valid", "checked-in", "cancelled", "refunded"];
const CHECKIN_FILTERS = ["checked-in", "not-checked-in"];

export function isBlockedAction(action) {
  return BLOCKED_ACTIONS.includes(action);
}

export function isReadAction(action) {
  return READ_ACTIONS.includes(action);
}

export function isOpenMutation(action) {
  return OPEN_MUTATIONS.includes(action);
}

// A super admin can refund a paid card charge. An admin can refund only after
// the event itself has been cancelled. The phrase is checked separately.
export function refundBlockReason({ role, eventStatus, orderStatus, charged }) {
  if (role !== "super_admin" && !(role === "admin" && eventStatus === "cancelled")) {
    return "An admin can refund only after the event is cancelled.";
  }
  if (!charged) return "This order has no card charge to refund.";
  if (orderStatus === "refunded" || orderStatus === "partially-refunded") return "This order already has a refund.";
  if (orderStatus === "disputed") return "This payment is disputed.";
  if (orderStatus !== "paid") return "Only a paid order can be refunded.";
  return null;
}

export function refundPhraseOk(value) {
  return value === "REFUND";
}

export function parseStaffEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

export function parseComplimentaryName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M} .,'’()-]+$/u.test(name)) return null;
  return name;
}

export function parseComplimentaryCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 10 ? count : null;
}

export function parseIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) return null;
  return value;
}

export function complimentaryPhraseOk(value) {
  return value === "SEND";
}

export function cashReceivedPhraseOk(value) {
  return value === "CASH RECEIVED";
}

export function cashReturnedPhraseOk(value) {
  return value === "I confirm the cash amount has been returned to the customer.";
}

export function parseGuestNumber(value) {
  const guest = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : Number(value);
  return Number.isInteger(guest) && guest >= 1 && guest <= 20 ? guest : null;
}

export function parsePaymentMethod(value) {
  if (value == null || value === "") return "";
  return value === "card" || value === "cash" ? value : null;
}

/** Issued / used / still-valid / revoked. Revoked passes are not remaining. */
export function complimentaryPassCounts(tickets) {
  const rows = Array.isArray(tickets) ? tickets : [];
  return {
    issued: rows.length,
    used: rows.filter((ticket) => ticket.status === "checked-in").length,
    remaining: rows.filter((ticket) => ticket.status === "valid").length,
    revoked: rows.filter((ticket) => ticket.status === "revoked").length,
  };
}

/** Derived from the passes. There is no stored status to edit. */
export function complimentaryIssuanceStatus(tickets) {
  const counts = complimentaryPassCounts(tickets);
  if (counts.issued === 0) return "Active";
  if (counts.revoked === counts.issued) return "Revoked";
  if (counts.revoked > 0) return "Partially revoked";
  if (counts.remaining === 0 && counts.used === counts.issued) return "Fully used";
  if (counts.used > 0 && counts.remaining > 0) return "Partially used";
  return "Active";
}

export function parseStaffRole(value) {
  if (value === "admin" || value === "door_staff" || value === "remove") return value;
  return null;
}

export function isLegacyDoorAccount(email, extra = "") {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === LEGACY_DOOR_EMAIL) return true;
  return String(extra)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function parsePage(pageValue, sizeValue) {
  const page = pageValue == null || pageValue === "" ? 1 : Number(pageValue);
  const fallbackSize = sizeValue == null || sizeValue === "";
  const pageSize = fallbackSize ? 25 : Number(sizeValue);
  if (!Number.isInteger(page) || page < 1 || page > 500) return null;
  if (!Number.isInteger(pageSize) || (pageSize !== 25 && pageSize !== 50)) return null;
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function parseEventId(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(value)) return null;
  return value;
}

export function parseTierId(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(value)) return null;
  return value;
}

export function parsePaymentStatus(value) {
  if (value == null || value === "") return "";
  return PAYMENT_STATES.includes(value) ? value : null;
}

export function parseRefundStatus(value) {
  if (value == null || value === "") return "";
  return REFUND_STATES.includes(value) ? value : null;
}

export function parseTicketStatus(value) {
  if (value == null || value === "") return "";
  return TICKET_FILTERS.includes(value) ? value : null;
}

export function parseCheckinFilter(value) {
  if (value == null || value === "") return "";
  return CHECKIN_FILTERS.includes(value) ? value : null;
}

export function parseDay(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value;
}

// Empty string means no search. null means the input is not safe to query.
export function cleanSearch(value) {
  if (value == null || value === "") return "";
  const query = String(value).trim().slice(0, 80);
  if (!query) return "";
  if (!/^[\p{L}\p{N}@.+_ -]+$/u.test(query)) return null;
  return query;
}

export function likePattern(query) {
  return `%${String(query).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function orderRefFromId(id) {
  const hex = String(id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return hex.length === 8 ? `OMC-${hex}` : "";
}

export function ticketRefFromId(id) {
  const hex = String(id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return hex.length === 8 ? `T-${hex}` : "";
}

export function parseOrderRef(value) {
  const match = /^OMC-([0-9A-F]{8})$/i.exec(String(value ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

export function parseTicketRef(value) {
  const match = /^T-([0-9A-F]{8})$/i.exec(String(value ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

export function splitCharge(amountTotal, unitPrice, quantity) {
  if (!Number.isInteger(amountTotal) || !Number.isInteger(unitPrice) || !Number.isInteger(quantity) || quantity < 1) {
    return null;
  }
  const subtotal = unitPrice * quantity;
  if (subtotal < 0 || amountTotal < subtotal) return null;
  return { subtotal, tax: amountTotal - subtotal, total: amountTotal };
}

export function refundLabel(status) {
  if (status === "refunded") return "Refunded";
  if (status === "partially-refunded") return "Partial";
  if (status === "disputed") return "Disputed";
  return "None";
}

export function emailLabel(emailedAt) {
  return emailedAt ? "Sent" : "Not sent";
}

export function displayTicketStatus(ticketStatus, orderStatus) {
  if (ticketStatus === "checked-in") return "CHECKED IN";
  if (ticketStatus === "revoked") return "REVOKED";
  if (ticketStatus === "valid") return "VALID";
  if (orderStatus === "refunded" || orderStatus === "partially-refunded") return "REFUNDED";
  if (ticketStatus === "cancelled") return "CANCELLED";
  return "CANCELLED";
}

export function displayScanResult(outcome, orderStatus) {
  if (outcome === "admitted") return "CHECKED IN";
  if (outcome === "already-used") return "ALREADY USED";
  if (outcome === "revoked") return "REVOKED";
  if (outcome === "cancelled" && (orderStatus === "refunded" || orderStatus === "partially-refunded")) return "REFUNDED";
  if (outcome === "cancelled") return "CANCELLED";
  return "INVALID";
}

export function checkInPercent(checkedIn, expected) {
  if (!Number.isInteger(checkedIn) || !Number.isInteger(expected) || expected < 1) return null;
  return Math.round((checkedIn / expected) * 1000) / 10;
}

/**
 * One row per admission ticket. A ticket is used only when its status is
 * "checked-in"; cancelled (refunded) and revoked tickets are neither expected nor remaining.
 */
export function ticketCounts(tickets) {
  const counts = { issued: 0, expected: 0, checkedIn: 0, remaining: 0, cancelled: 0 };
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    counts.issued += 1;
    if (ticket.status === "cancelled" || ticket.status === "revoked") counts.cancelled += 1;
    else {
      counts.expected += 1;
      if (ticket.status === "checked-in") counts.checkedIn += 1;
      else counts.remaining += 1;
    }
  }
  return counts;
}

/** Everyone admitted by ticket QR at the door: paid (card and cash) plus complimentary. VIP is counted on its own. */
export function doorTotals(paid, complimentary) {
  const expected = paid.expected + complimentary.expected;
  const checkedIn = paid.checkedIn + complimentary.checkedIn;
  return {
    expected,
    checkedIn,
    remaining: paid.remaining + complimentary.remaining,
    cancelled: paid.cancelled + complimentary.cancelled,
    percent: checkInPercent(checkedIn, expected),
  };
}

export function zoneForVenue(venue, address) {
  const text = `${venue ?? ""} ${address ?? ""}`.toLowerCase();
  if (/\bhouston\b|\btexas\b|\btx\b/.test(text)) return "America/Chicago";
  return "UTC";
}

export function dayKey(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function shiftDay(day, delta) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + delta));
  return next.toISOString().slice(0, 10);
}

export function safeResource(type, id) {
  if (!id) return null;
  const text = String(id);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    if (type === "ticket") return ticketRefFromId(text);
    if (type === "order") return orderRefFromId(text);
    return text.replace(/-/g, "").slice(0, 8);
  }
  return text.slice(0, 80);
}

const SECRET_VALUE = /^(?:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[0-9a-f]{24,}|sk_(?:live|test)_[A-Za-z0-9]+)$/i;

export function redactAudit(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(summary)) {
    if (/token|secret|password|authorization|cookie|card|pan|otp|totp/i.test(key)) continue;
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) continue;
      clean[key] = value.slice(0, 200);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      clean[key] = value;
    }
  }
  return clean;
}
