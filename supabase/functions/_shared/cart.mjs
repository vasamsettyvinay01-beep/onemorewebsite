// Mixed-ticket cart pricing. Pure functions, integer cents only. Shared by
// checkout, the Stripe webhook, and tests so every surface computes the same numbers.
//
// The browser sends only { ticket_type, quantity } lines. Everything else here
// is derived from database tier rows and the promotion row.

import { percentDiscountCents, promoSnapshotAllowsTier, promoTierSnapshot } from "./promo.mjs";

/** Most admissions (people) one payment may carry. Couple counts 2, Group of 5 counts 5. */
export const MAX_CART_ADMISSIONS = 20;
/** Most distinct ticket types in one cart. */
export const MAX_CART_LINES = 8;
/** orders.tier_id for an order that holds more than one ticket type. */
export const MIXED_TIER_ID = "mixed";
/** Never purchasable through public checkout, whatever a request or a tiers row says. */
export const NON_PUBLIC_TIER_IDS = ["complimentary", "vip", MIXED_TIER_ID];

const TIER_ID_RE = /^[a-z0-9_-]{1,64}$/i;

export const CART_ERRORS = {
  bad_cart: "Choose your tickets.",
  empty_cart: "Select at least one ticket.",
  too_many_lines: "Choose fewer ticket types.",
  duplicate_item: "Each ticket type can only be listed once.",
  bad_quantity: "Choose how many passes.",
  not_public: "This pass isn't available.",
  too_many_admissions: `Up to ${MAX_CART_ADMISSIONS} admissions per booking.`,
};

/**
 * Validates the browser's cart. Returns { items } with normalized ids in request
 * order, or { error } with one of CART_ERRORS' keys. Extra keys on a line
 * (price, name, admits, discount…) are never read.
 */
export function parseCartItems(raw) {
  if (!Array.isArray(raw)) return { error: "bad_cart" };
  if (raw.length === 0) return { error: "empty_cart" };
  if (raw.length > MAX_CART_LINES) return { error: "too_many_lines" };
  const seen = new Set();
  const items = [];
  for (const line of raw) {
    if (!line || typeof line !== "object" || Array.isArray(line)) return { error: "bad_cart" };
    const tierId = line.ticket_type;
    if (typeof tierId !== "string" || !TIER_ID_RE.test(tierId)) return { error: "not_public" };
    if (NON_PUBLIC_TIER_IDS.includes(tierId.toLowerCase())) return { error: "not_public" };
    const quantity = line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CART_ADMISSIONS) return { error: "bad_quantity" };
    if (seen.has(tierId)) return { error: "duplicate_item" };
    seen.add(tierId);
    items.push({ tierId, quantity });
  }
  return { items };
}

/** Admissions one line carries. `admits` is the tier's own multiplier (Couple 2, Group of 5 is 5). */
export function lineAdmissions(quantity, admits) {
  return quantity * Math.max(Number.isInteger(admits) ? admits : 1, 1);
}

/**
 * Prices a cart from server-side tier rows.
 *
 * lines: [{ tierId, name, unitCents, quantity, admits }]
 * promo: null | { percent, eligibleTierIds }
 *
 * The promo discounts only lines whose tier is eligible. Each eligible line is
 * rounded to the cent on its own (the same half-up rule single tickets use), so
 * the line discounts always sum exactly to the order discount.
 *
 * @param {{ tierId: string, name: string, unitCents: number, quantity: number, admits?: number }[]} lines
 * @param {{ percent: number, eligibleTierIds: string[] } | null} [promo]
 */
export function priceCart(lines, promo = null) {
  let originalSubtotal = 0;
  let discount = 0;
  let eligibleSubtotal = 0;
  let totalAdmissions = 0;
  let totalUnits = 0;
  const priced = lines.map((line) => {
    if (!Number.isSafeInteger(line.unitCents) || line.unitCents < 0) throw new Error("bad_unit");
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("bad_quantity");
    const admissionsPerUnit = Math.max(Number.isInteger(line.admits) ? line.admits : 1, 1);
    const originalLine = line.unitCents * line.quantity;
    const eligible = !!promo && promo.eligibleTierIds.includes(line.tierId);
    const lineDiscount = eligible ? percentDiscountCents(originalLine, promo.percent) : 0;
    originalSubtotal += originalLine;
    discount += lineDiscount;
    if (eligible) eligibleSubtotal += originalLine;
    totalAdmissions += admissionsPerUnit * line.quantity;
    totalUnits += line.quantity;
    return {
      tierId: line.tierId,
      name: line.name,
      unitCents: line.unitCents,
      quantity: line.quantity,
      admissionsPerUnit,
      totalAdmissions: admissionsPerUnit * line.quantity,
      originalLineCents: originalLine,
      promoEligible: eligible,
      discountCents: lineDiscount,
      discountedLineCents: originalLine - lineDiscount,
    };
  });
  return {
    lines: priced,
    originalSubtotal,
    discount,
    discountedSubtotal: originalSubtotal - discount,
    eligibleSubtotal,
    totalAdmissions,
    totalUnits,
  };
}

/** True when a promo exists but no line in the cart can take it. */
export function promoHasNoEligibleLine(lines, eligibleTierIds) {
  return !lines.some((line) => eligibleTierIds.includes(line.tierId));
}

/**
 * Splits `total` cents across `weights` so the parts sum exactly to `total`
 * (largest remainder, ties to the earlier line). Used only to apportion order
 * tax across lines for reporting; the order total itself is never recomputed.
 */
export function allocateCents(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("bad_total");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((value) => Math.floor(value));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((value, i) => ({ i, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Adds tax and line totals to priced lines. Tax is apportioned by discounted line value. */
export function withLineTax(priced, taxCents) {
  const shares = allocateCents(taxCents, priced.lines.map((line) => line.discountedLineCents));
  return priced.lines.map((line, i) => ({
    ...line,
    taxCents: shares[i],
    lineTotalCents: line.discountedLineCents + shares[i],
  }));
}

/**
 * The frozen record a PaymentIntent points at. Everything the webhook and the
 * order RPC need to rebuild the purchase, so nothing depends on today's prices.
 * `promo` is { id, code, percent, eligibleTierIds } or null.
 *
 * @param {{ priced: ReturnType<typeof priceCart>, tax: number, currency: string, promo?: { id: string, code: string, percent: number, eligibleTierIds: string[] } | null }} input
 */
export function buildCartSnapshot({ priced, tax, currency, promo = null }) {
  const lines = withLineTax(priced, tax).map((line, index) => ({
    position: index + 1,
    tierId: line.tierId,
    name: line.name,
    unitCents: line.unitCents,
    quantity: line.quantity,
    admissionsPerUnit: line.admissionsPerUnit,
    totalAdmissions: line.totalAdmissions,
    originalLineCents: line.originalLineCents,
    promoEligible: line.promoEligible,
    discountCents: line.discountCents,
    discountedLineCents: line.discountedLineCents,
    taxCents: line.taxCents,
    lineTotalCents: line.lineTotalCents,
  }));
  return {
    version: 1,
    currency: String(currency).toLowerCase(),
    lines,
    originalSubtotal: priced.originalSubtotal,
    discount: priced.discount,
    discountedSubtotal: priced.discountedSubtotal,
    eligibleSubtotal: priced.eligibleSubtotal,
    tax,
    total: priced.discountedSubtotal + tax,
    totalAdmissions: priced.totalAdmissions,
    totalUnits: priced.totalUnits,
    promo: promo
      ? { id: promo.id, code: promo.code, percent: promo.percent, eligibleTiers: promoTierSnapshot(promo.eligibleTierIds) }
      : null,
  };
}

/** "female:1,general:2,couple:1" — short enough for one PaymentIntent metadata value. */
export function cartMetaSummary(lines) {
  return lines.map((line) => `${line.tierId}:${line.quantity}`).join(",");
}

/** "Female × 1, Male × 2, Couple × 1" */
export function cartSummaryLabel(lines) {
  return lines.map((line) => `${line.name} × ${line.quantity}`).join(", ");
}

/**
 * The webhook's internal-consistency check on a frozen cart snapshot: every
 * number is recomputed from unit prices, quantities, admissions and the promo
 * percent, and must equal what checkout stored. Returns a reason string or null.
 */
export function verifyCartSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0) return "snapshot_shape";
    if (snapshot.lines.length > MAX_CART_LINES) return "snapshot_shape";
    const promo = snapshot.promo
      ? { percent: snapshot.promo.percent, eligibleTierIds: String(snapshot.promo.eligibleTiers ?? "").split(",").filter(Boolean) }
      : null;
    const ids = new Set();
    for (const line of snapshot.lines) {
      if (!line || typeof line.tierId !== "string" || ids.has(line.tierId)) return "snapshot_duplicate";
      ids.add(line.tierId);
      if (NON_PUBLIC_TIER_IDS.includes(line.tierId.toLowerCase())) return "snapshot_tier";
      if (promo && line.promoEligible !== (promoSnapshotAllowsTier(snapshot.promo.eligibleTiers, line.tierId) === "allowed")) {
        return "snapshot_promo_line";
      }
      if (!promo && line.promoEligible) return "snapshot_promo_line";
    }
    const again = priceCart(
      snapshot.lines.map((line) => ({
        tierId: line.tierId,
        name: line.name,
        unitCents: line.unitCents,
        quantity: line.quantity,
        admits: line.admissionsPerUnit,
      })),
      promo,
    );
    if (again.totalAdmissions > MAX_CART_ADMISSIONS) return "snapshot_admissions";
    if (
      again.originalSubtotal !== snapshot.originalSubtotal ||
      again.discount !== snapshot.discount ||
      again.discountedSubtotal !== snapshot.discountedSubtotal ||
      again.totalAdmissions !== snapshot.totalAdmissions
    ) {
      return "snapshot_totals";
    }
    for (let i = 0; i < again.lines.length; i += 1) {
      const a = again.lines[i];
      const b = snapshot.lines[i];
      if (
        a.originalLineCents !== b.originalLineCents ||
        a.discountCents !== b.discountCents ||
        a.discountedLineCents !== b.discountedLineCents ||
        a.totalAdmissions !== b.totalAdmissions
      ) {
        return "snapshot_line";
      }
    }
    if (!Number.isSafeInteger(snapshot.tax) || snapshot.tax < 0) return "snapshot_tax";
    if (snapshot.total !== snapshot.discountedSubtotal + snapshot.tax) return "snapshot_total";
    return null;
  } catch {
    return "snapshot_shape";
  }
}
