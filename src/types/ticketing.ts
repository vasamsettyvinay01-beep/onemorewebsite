/**
 * Ticketing domain types.
 *
 * Nothing here is implemented against a real backend yet. These contracts
 * exist so the public UI, the future payment integration (Stripe or
 * equivalent, Apple Pay, Google Pay) and the future admin / scanner tools can
 * all be built against the same vocabulary without rewriting the website.
 *
 * Security intent (future):
 *  - Tickets are generated server-side only after a verified payment webhook.
 *  - Each admission is its own Ticket with its own opaque `secureToken`.
 *  - QR codes encode ONLY the secure token. Never personal data.
 *  - Validation and check-in happen server-side and atomically.
 */

import type { OneMoreEvent, TicketTier } from "./event";

export type TicketStatus = "valid" | "checked-in" | "cancelled" | "refunded";

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially-refunded"
  | "cancelled";

export type PaymentMethod = "card" | "apple-pay" | "google-pay" | "link" | "other";

/** The only purchaser information the checkout collects. */
export interface Purchaser {
  name: string;
  email: string;
}

export interface OrderLine {
  tierId: TicketTier["id"];
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  eventId: OneMoreEvent["id"];
  status: OrderStatus;
  purchaser: Purchaser;
  lines: OrderLine[];
  subtotalCents: number;
  feesCents: number;
  totalCents: number;
  currency: string;
  paymentMethod?: PaymentMethod;
  /** Provider reference, e.g. Stripe PaymentIntent id. */
  paymentReference?: string;
  promoCode?: string;
  createdAt: string;
  paidAt?: string;
}

export interface Ticket {
  ticketId: string;
  orderId: Order["id"];
  eventId: OneMoreEvent["id"];
  tierId: TicketTier["id"];
  /** Opaque, unguessable, server-issued. This is what the QR code contains. */
  secureToken: string;
  status: TicketStatus;
  createdAt: string;
  checkedInAt?: string;
  checkedInBy?: string;
}

export interface CheckIn {
  ticketId: Ticket["ticketId"];
  eventId: OneMoreEvent["id"];
  checkedInAt: string;
  checkedInBy: string;
  device?: string;
}

/** Result of a server-side scan. */
export type ScanResult =
  | { outcome: "valid"; ticket: Ticket }
  | { outcome: "already-used"; ticket: Ticket; checkIn: CheckIn }
  | { outcome: "invalid"; reason: "not-found" | "cancelled" | "refunded" | "wrong-event" };

/* ------------------------------------------------------------------------ */
/* Checkout (client → future API)                                            */
/* ------------------------------------------------------------------------ */

/** What the public UI sends when a purchaser commits to buying. */
export interface CheckoutIntent {
  eventId: OneMoreEvent["id"];
  lines: OrderLine[];
  /** Omitted when the provider's hosted page collects it. */
  purchaser?: Purchaser;
  promoCode?: string;
}

export type CheckoutMode = "disabled" | "live";

export type CheckoutResult =
  | { ok: true; orderId: Order["id"]; clientSecret?: string; redirectUrl?: string }
  | { ok: false; error: string };

/**
 * Abstraction over the payment provider. The UI depends on this interface,
 * never on Stripe directly. A real implementation will live server-side and
 * be reached through an API route / server action.
 */
export interface CheckoutProvider {
  readonly mode: CheckoutMode;
  readonly supportsApplePay: boolean;
  readonly supportsGooglePay: boolean;
  /** Quantity, name and email are collected on the provider's hosted page, not in the sheet. */
  readonly collectsPurchaserDetails: boolean;
  createCheckout(intent: CheckoutIntent): Promise<CheckoutResult>;
}

/** Confirmation screen data after a verified payment. */
export interface OrderConfirmation {
  orderId: Order["id"];
  eventName: string;
  ticketCount: number;
  email: string;
  ticketsUrl?: string;
  /** Display-only details for the keepsake ticket card. Omitted values print as "TBA". */
  chapter?: number;
  dateLabel?: string;
  placeLabel?: string;
  holderName?: string;
  tierName?: string;
}
