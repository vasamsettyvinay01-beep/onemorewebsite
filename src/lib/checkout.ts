import type { OneMoreEvent } from "@/types/event";
import type { CheckoutProvider, CheckoutIntent, CheckoutResult } from "@/types/ticketing";
import { backend, backendConfigured } from "@/data/backend";


/**
 * Checkout provider factory.
 *
 * Live sales run through the on-site checkout at /checkout: Stripe Elements
 * styled to the brand, priced server-side by the `checkout` Edge Function.
 * The sheet just hands the chosen tier over to that page.
 *
 * Until the backend and Stripe key are configured the provider is `disabled`:
 * the ticket sheet shows the "COMING SOON" state and never pretends to take money.
 */
const disabledProvider: CheckoutProvider = {
  mode: "disabled",
  supportsApplePay: false,
  supportsGooglePay: false,
  collectsPurchaserDetails: false,
  async createCheckout(): Promise<CheckoutResult> {
    return { ok: false, error: "Ticket sales are not open yet." };
  },
};

function onSiteProvider(event: OneMoreEvent): CheckoutProvider {
  return {
    mode: "live",
    supportsApplePay: false,
    supportsGooglePay: false,
    collectsPurchaserDetails: true,
    async createCheckout(intent: CheckoutIntent): Promise<CheckoutResult> {
      const tierId = intent.lines[0]?.tierId ?? "";
      const qs = new URLSearchParams({ event: event.slug, tier: tierId });
      return { ok: true, orderId: `${event.id}__${tierId}`, redirectUrl: `/checkout?${qs}` };
    },
  };
}

export function getCheckoutProvider(event: OneMoreEvent): CheckoutProvider {
  return backendConfigured && backend.stripeKey ? onSiteProvider(event) : disabledProvider;
}

export function calculateTotalCents(lines: CheckoutIntent["lines"]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
}
