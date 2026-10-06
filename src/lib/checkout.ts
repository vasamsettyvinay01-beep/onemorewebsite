import type { CheckoutProvider, CheckoutIntent, CheckoutResult } from "@/types/ticketing";


/**
 * Checkout provider factory.
 *
 * Until a real payment gateway is configured the provider is `disabled`:
 * the ticket sheet shows the "COMING SOON" state and never pretends to
 * take money. A live implementation should be added as a separate module
 * (e.g. `stripeCheckoutProvider`) that calls a server route, and selected
 * here based on `NEXT_PUBLIC_CHECKOUT_MODE=live`.
 */
const disabledProvider: CheckoutProvider = {
  mode: "disabled",
  supportsApplePay: false,
  supportsGooglePay: false,
  async createCheckout(): Promise<CheckoutResult> {
    return { ok: false, error: "Ticket sales are not open yet." };
  },
};

export function getCheckoutProvider(): CheckoutProvider {
  // Future: if (process.env.NEXT_PUBLIC_CHECKOUT_MODE === "live") return stripeCheckoutProvider;
  return disabledProvider;
}

export function calculateTotalCents(lines: CheckoutIntent["lines"]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
}
