// Promo pricing. Pure functions, integer cents only. Shared by checkout, the
// Stripe webhook, and the admin report so every surface computes the same numbers.

export const PROMO_INVALID = "PROMO CODE NOT VALID";
export const PROMO_NOT_ELIGIBLE = "PROMO_NOT_ELIGIBLE";

const CODE_RE = /^[A-Z0-9]{3,32}$/;
const TIER_ID_RE = /^[a-z0-9_-]{1,64}$/;

// "" means no code was entered. null means the input can never be a code.
export function normalizePromoCode(value) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (!code) return "";
  return CODE_RE.test(code) ? code : null;
}

// Half-up to the cent: 1999 × 15% = 299.85 → 300.
export function percentDiscountCents(subtotalCents, percent) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error("bad_subtotal");
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("bad_percent");
  return Math.floor((subtotalCents * percent + 50) / 100);
}

export function priceTickets({ unitCents, quantity, percent = 0 }) {
  if (!Number.isSafeInteger(unitCents) || unitCents < 0) throw new Error("bad_unit");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("bad_quantity");
  const originalSubtotal = unitCents * quantity;
  const discount = percentDiscountCents(originalSubtotal, percent);
  return { originalSubtotal, discount, discountedSubtotal: originalSubtotal - discount };
}

export function promotionIsLive(promotion, eventId, now = Date.now()) {
  if (!promotion || promotion.event_id !== eventId || promotion.active !== true) return false;
  if (promotion.discount_type !== "percentage") return false;
  const value = promotion.discount_value;
  if (!Number.isInteger(value) || value < 1 || value > 100) return false;
  if (promotion.starts_at && !(Date.parse(promotion.starts_at) <= now)) return false;
  if (promotion.expires_at && !(Date.parse(promotion.expires_at) > now)) return false;
  return true;
}

// Admin orders filter: "" (all), "none" (no promo), or a canonical code.
export function parsePromoFilter(value) {
  if (value == null || value === "") return "";
  if (value === "none") return "none";
  const code = normalizePromoCode(value);
  return code ? code : null;
}

export function promoLabel(code, percent) {
  return code && Number.isInteger(percent) ? `${code} — ${percent}% OFF` : "";
}

// Stable tier ids from the promotion row. Display names are never accepted.
export function eligibleTierIds(promotion) {
  const ids = promotion?.eligible_tier_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && TIER_ID_RE.test(id));
}

export function promotionAppliesToTier(promotion, tierId) {
  return typeof tierId === "string" && eligibleTierIds(promotion).includes(tierId);
}

export function promoEligibilityMessage(code, tierNames) {
  const names = (Array.isArray(tierNames) ? tierNames : []).filter((name) => typeof name === "string" && name.trim());
  if (names.length === 1) return `${code} is valid for ${names[0]} tickets only.`;
  if (names.length === 2) return `${code} is valid for ${names[0]} and ${names[1]} tickets only.`;
  if (names.length > 2) {
    const last = names[names.length - 1];
    return `${code} is valid for ${names.slice(0, -1).join(", ")}, and ${last} tickets only.`;
  }
  return `${code} is not valid for this ticket.`;
}

// Frozen onto the PaymentIntent at checkout. Later edits to the promotion
// must not change what this charge was allowed to discount.
export function promoTierSnapshot(ids) {
  return [...new Set(eligibleTierIds({ eligible_tier_ids: ids }))].sort().join(",");
}

// "" means the PaymentIntent was created before eligibility was snapshotted.
// Those already-priced charges stay fulfillable. Anything else is decided
// only from the snapshot, never from the current promotions row.
export function promoSnapshotAllowsTier(snapshot, tierId) {
  if (typeof tierId !== "string" || !TIER_ID_RE.test(tierId)) return "ineligible";
  if (snapshot == null || snapshot === "") return "legacy";
  if (typeof snapshot !== "string" || snapshot.length > 500) return "ineligible";
  const allowed = snapshot.split(",");
  if (allowed.length === 0 || allowed.some((id) => !TIER_ID_RE.test(id))) return "ineligible";
  return allowed.includes(tierId) ? "allowed" : "ineligible";
}
