/**
 * Mixed-ticket cart helpers for the checkout page.
 *
 * Everything here is presentation: which steppers can move, how many admissions the
 * cart holds, and how a quote is shown. The server prices the cart, applies the promo
 * code to eligible lines, calculates tax and enforces every limit. The browser sends
 * only ticket ids and quantities.
 */

/** Matches the server: most admissions in one booking. */
export const MAX_CART_ADMISSIONS = 20;
/** Matches the server's per-ticket default when a tier sets no limit. */
const DEFAULT_MAX_PER_LINE = 10;
/**
 * Ids the public checkout never offers. Invitation and complimentary passes are not in the
 * public ticket data at all, and the server refuses them whatever the browser sends.
 */
export const NON_PUBLIC_TIER_IDS = ["complimentary", "mixed"];

export interface CartTier {
  id: string;
  admits?: number;
  maxPerOrder?: number;
}

export type Quantities = Record<string, number>;

export interface CartItem {
  ticket_type: string;
  quantity: number;
}

export interface QuoteLine {
  ticket_type: string;
  name: string;
  unitCents: number;
  quantity: number;
  admissions: number;
  lineSubtotal: number;
  discount: number;
  discountedSubtotal: number;
  promoEligible: boolean;
}

export function admitsOf(tier: CartTier): number {
  return Math.max(tier.admits ?? 1, 1);
}

/** The cart as the server expects it: ticket id and quantity, in ticket order, zero lines left out. */
export function cartItems(tiers: CartTier[], quantities: Quantities): CartItem[] {
  return tiers
    .filter((tier) => (quantities[tier.id] ?? 0) > 0)
    .map((tier) => ({ ticket_type: tier.id, quantity: quantities[tier.id] }));
}

/** Real admissions: a Couple counts two, a Group of 5 counts five. */
export function cartAdmissions(tiers: CartTier[], quantities: Quantities): number {
  return tiers.reduce((sum, tier) => sum + (quantities[tier.id] ?? 0) * admitsOf(tier), 0);
}

/** Ticket types with at least one ticket. */
export function cartSelections(tiers: CartTier[], quantities: Quantities): number {
  return tiers.filter((tier) => (quantities[tier.id] ?? 0) > 0).length;
}

export function tierLimit(tier: CartTier): number {
  return Math.max(1, Math.min(tier.maxPerOrder ?? DEFAULT_MAX_PER_LINE, DEFAULT_MAX_PER_LINE));
}

export function canIncrease(tiers: CartTier[], quantities: Quantities, tier: CartTier): boolean {
  const current = quantities[tier.id] ?? 0;
  if (current >= tierLimit(tier)) return false;
  return cartAdmissions(tiers, quantities) + admitsOf(tier) <= MAX_CART_ADMISSIONS;
}

export function canDecrease(quantities: Quantities, tier: CartTier): boolean {
  return (quantities[tier.id] ?? 0) > 0;
}

/** A changed cart is a different quote and a different payment attempt. */
export function cartKey(items: CartItem[]): string {
  return items.map((item) => `${item.ticket_type}:${item.quantity}`).join(",");
}

/**
 * The request body for a quote or a payment. A cart with one ticket type uses the
 * original single-ticket request, which is the production-proven path. Two or more
 * ticket types use the cart request. Either way the browser sends ids and quantities only.
 */
export function requestBody(eventId: string, items: CartItem[], extra: Record<string, unknown>): Record<string, unknown> {
  if (items.length === 1) return { eventId, tierId: items[0].ticket_type, quantity: items[0].quantity, ...extra };
  return { eventId, items, ...extra };
}

/** Drop quantities for tickets that are no longer for sale or exceed a limit. */
export function clampQuantities(tiers: CartTier[], quantities: Quantities): Quantities {
  const next: Quantities = {};
  let admissions = 0;
  for (const tier of tiers) {
    const wanted = Math.min(Math.max(Math.trunc(quantities[tier.id] ?? 0), 0), tierLimit(tier));
    const room = Math.floor((MAX_CART_ADMISSIONS - admissions) / admitsOf(tier));
    const quantity = Math.max(0, Math.min(wanted, room));
    if (quantity > 0) next[tier.id] = quantity;
    admissions += quantity * admitsOf(tier);
  }
  return next;
}

/** The names a code applies to, as the banner prints them: "FEMALE + MALE". */
export function promoScopeLabel(names: string[]): string {
  return names.map((name) => name.toUpperCase()).join(" + ");
}

/**
 * One quote line for each ticket type. The cart endpoint returns lines; the single-ticket
 * endpoint does not, so a one-line cart is rebuilt from the figures it does return.
 */
export function normaliseLines(
  body: Record<string, unknown>,
  single: { id: string; name: string; unitCents: number; quantity: number; admits: number } | null,
): QuoteLine[] | null {
  if (Array.isArray(body.lines)) {
    const lines: QuoteLine[] = [];
    for (const raw of body.lines as Record<string, unknown>[]) {
      if (
        !raw ||
        typeof raw.ticket_type !== "string" ||
        typeof raw.name !== "string" ||
        typeof raw.unitCents !== "number" ||
        typeof raw.quantity !== "number" ||
        typeof raw.admissions !== "number" ||
        typeof raw.lineSubtotal !== "number" ||
        typeof raw.discount !== "number" ||
        typeof raw.discountedSubtotal !== "number"
      ) {
        return null;
      }
      lines.push({
        ticket_type: raw.ticket_type,
        name: raw.name,
        unitCents: raw.unitCents,
        quantity: raw.quantity,
        admissions: raw.admissions,
        lineSubtotal: raw.lineSubtotal,
        discount: raw.discount,
        discountedSubtotal: raw.discountedSubtotal,
        promoEligible: raw.promoEligible === true,
      });
    }
    return lines;
  }
  if (!single || typeof body.subtotal !== "number") return null;
  const discount = typeof body.discount === "number" ? body.discount : 0;
  return [
    {
      ticket_type: single.id,
      name: single.name,
      unitCents: single.unitCents,
      quantity: single.quantity,
      admissions: single.quantity * single.admits,
      lineSubtotal: body.subtotal,
      discount,
      discountedSubtotal: typeof body.discountedSubtotal === "number" ? body.discountedSubtotal : body.subtotal - discount,
      promoEligible: discount > 0,
    },
  ];
}
