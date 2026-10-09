/**
 * Checkout contracts shared by the ticket sheet and the on-site /checkout page.
 * Passes themselves are created only after Stripe confirms payment.
 */

import type { OneMoreEvent, TicketTier } from "./event";

export interface OrderLine {
  tierId: TicketTier["id"];
  quantity: number;
  unitPriceCents: number;
}

/** What the ticket sheet sends when a guest continues to checkout. */
export interface CheckoutIntent {
  eventId: OneMoreEvent["id"];
  lines: OrderLine[];
}

export type CheckoutMode = "disabled" | "live";

export type CheckoutResult =
  | { ok: true; orderId: string; redirectUrl?: string }
  | { ok: false; error: string };

/** The ticket sheet depends on this, never on Stripe directly. */
export interface CheckoutProvider {
  readonly mode: CheckoutMode;
  createCheckout(intent: CheckoutIntent): Promise<CheckoutResult>;
}
