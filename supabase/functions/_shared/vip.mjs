// Pure helpers for private VIP invitations. No database access and no secrets.
// Used by the admin, door, and vip-pass functions and by the node tests.

export const VIP_MIN_CAPACITY = 1;
export const VIP_MAX_CAPACITY = 6;
export const VIP_CAPACITIES = [1, 2, 3, 4, 5, 6];

export const VIP_TOKEN_RE = /^vip_[0-9a-f]{48}$/;
export const VIP_CODE_RE = /^VIP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export const VIP_STATUSES = ["issued", "partially_admitted", "fully_admitted", "revoked", "cancelled"];
export const VIP_LIVE_STATUSES = ["issued", "partially_admitted"];

/** Guest-facing title. The production event row is still called "Diwali Night". */
export const VIP_EVENT_TITLES = { evt_diwali_night: "Indian Diwali Night" };

export function parseVipCapacity(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= VIP_MIN_CAPACITY && count <= VIP_MAX_CAPACITY ? count : null;
}

export function parseVipAdmitCount(value) {
  return parseVipCapacity(value);
}

export function parseVipHostName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M} .,'’()-]+$/u.test(name)) return null;
  return name;
}

export function parseVipTableLabel(value) {
  if (typeof value !== "string") return null;
  const label = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > 40 || !/^[\p{L}\p{N} &'’.#/-]+$/u.test(label)) return null;
  return label;
}

/** Empty is allowed. null means the value is present but not acceptable. */
export function parseVipPhone(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return "";
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/\s+/g, " ");
  const digits = phone.replace(/\D/g, "");
  if (phone.length < 7 || phone.length > 40 || digits.length < 7 || digits.length > 15 || !/^[+\d ().-]+$/.test(phone)) return null;
  return phone;
}

export function parseVipNote(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return "";
  if (typeof value !== "string") return null;
  const note = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (note.length > 200 || /[<>]/.test(note)) return null;
  return note;
}

export function parseVipCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return VIP_CODE_RE.test(code) ? code : null;
}

export function isVipToken(value) {
  return typeof value === "string" && VIP_TOKEN_RE.test(value);
}

export function revokePhraseOk(value) {
  return value === "REVOKE";
}

export function vipStatusLabel(status) {
  switch (status) {
    case "issued":
      return "Issued";
    case "partially_admitted":
      return "Partially admitted";
    case "fully_admitted":
      return "Fully admitted";
    case "revoked":
      return "Revoked";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function vipRemaining(capacity, admitted) {
  return Math.max((Number(capacity) || 0) - (Number(admitted) || 0), 0);
}

/** Door buttons: 1..remaining, never more than remaining, never more than six. */
export function admitChoices(remaining) {
  const max = Math.min(Math.max(Math.floor(Number(remaining) || 0), 0), VIP_MAX_CAPACITY);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function guestsLabel(count) {
  return `${count} ${count === 1 ? "Guest" : "Guests"}`;
}

export function vipSummary(rows) {
  const summary = { groups: 0, allocated: 0, admitted: 0, remaining: 0, revoked: 0, cancelled: 0 };
  for (const row of rows) {
    const capacity = Number(row.capacity) || 0;
    const admitted = Number(row.admitted) || 0;
    summary.admitted += admitted;
    if (row.status === "revoked") {
      summary.revoked += 1;
      continue;
    }
    if (row.status === "cancelled") {
      summary.cancelled += 1;
      continue;
    }
    summary.groups += 1;
    summary.allocated += capacity;
    summary.remaining += vipRemaining(capacity, admitted);
  }
  return summary;
}

/** "Saturday, November 7, 2026" → "November 7, 2026". */
export function longDate(label) {
  return String(label ?? "").replace(/^[A-Za-z]+,\s*/, "").trim();
}

/** "Saturday, November 7, 2026" → "Nov 7". */
export function shortDate(label) {
  const match = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})/.exec(longDate(label));
  return match ? `${match[1]} ${match[2]}` : longDate(label);
}

/** "2515 Morse St, Houston, TX 77019" → "Houston". */
export function cityFromAddress(address) {
  const parts = String(address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : parts[1] ?? "";
}

/** Event facts for the invitation, read from the production tier metadata. */
export function vipEventFromMetadata(eventId, meta = {}) {
  return {
    title: VIP_EVENT_TITLES[eventId] || meta.omc_event_name || "One More",
    date: longDate(meta.omc_event_date),
    shortDate: shortDate(meta.omc_event_date),
    time: String(meta.omc_event_time ?? "").trim(),
    venue: String(meta.omc_venue_name ?? "").trim(),
    city: cityFromAddress(meta.omc_venue_address),
    address: String(meta.omc_venue_address ?? "").trim(),
    mapUrl: String(meta.omc_map_url ?? "").trim(),
    minAge: Number(meta.omc_min_age) || null,
  };
}

/** `omc_partners` metadata → partner list. Logo values are storage keys under brand/. */
export function vipPartnersFromMetadata(raw) {
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row.name === "string" && typeof row.logo === "string" && /^[a-z0-9/_.-]+\.(png|jpe?g|webp|svg)$/i.test(row.logo))
      .map((row) => ({
        name: row.name.slice(0, 80),
        logo: row.logo.replace(/^\/+/, ""),
        width: Number(row.w) > 0 ? Number(row.w) : 2,
        height: Number(row.h) > 0 ? Number(row.h) : 1,
      }));
  } catch {
    return [];
  }
}

/**
 * Equal perceived weight: every mark gets the same visual area, then is clamped
 * to the shared box. Width alone would make wide marks dominate.
 */
export function partnerBox(width, height, { area, maxWidth, maxHeight }) {
  const ratio = width > 0 && height > 0 ? width / height : 2;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  w *= scale;
  h *= scale;
  return { width: Math.round(w), height: Math.round(h) };
}

/** The only fields a public pass response may contain. */
export function publicVipPass(row, event, partners) {
  if (!row || !VIP_LIVE_STATUSES.concat("fully_admitted").includes(row.status)) {
    return { status: "inactive" };
  }
  const capacity = Number(row.capacity) || 0;
  const admitted = Number(row.admitted) || 0;
  return {
    status: row.status === "fully_admitted" ? "complete" : row.status === "partially_admitted" ? "partial" : "issued",
    table: String(row.table_label),
    host: String(row.host_name),
    capacity,
    admitted,
    remaining: vipRemaining(capacity, admitted),
    code: String(row.code),
    event,
    partners: partners.map((partner) => ({ name: partner.name, logo: partner.logo, width: partner.width, height: partner.height })),
  };
}

/** Words that must never appear on anything a VIP guest sees. */
export const VIP_FORBIDDEN_GUEST_TERMS = /\$|\bprice\b|\bpricing\b|\bfree\b|complimentary|\bdiscount|\bsubtotal\b|\btax(es)?\b|\btotal\b|\bcheckout\b|\bpayment\b|\bpaid\b|\bvalue\b|\bcost\b|\bUSD\b|\border\b/i;
