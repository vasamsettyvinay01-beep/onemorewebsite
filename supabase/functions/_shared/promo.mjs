// Promo pricing. Pure functions, integer cents only. Shared by checkout, the
// Stripe webhook, and the admin report so every surface computes the same numbers.

export const PROMO_INVALID = "PROMO CODE NOT VALID";

const CODE_RE = /^[A-Z0-9]{3,32}$/;

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
