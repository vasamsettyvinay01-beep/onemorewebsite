import type { OneMoreEvent } from "@/types/event";
import type { CheckoutProvider, CheckoutIntent, CheckoutResult } from "@/types/ticketing";
import { backend, backendConfigured } from "@/data/backend";

/**
 * Live sales run through the on-site checkout at /checkout. The sheet only
 * hands the chosen tier over; that page collects the guest and the payment.
 *
 * Until the backend and Stripe key are configured the provider is `disabled`:
 * the ticket sheet shows "COMING SOON" and never pretends to take money.
 */
const disabledProvider: CheckoutProvider = {
  mode: "disabled",
  async createCheckout(): Promise<CheckoutResult> {
    return { ok: false, error: "Ticket sales are not open yet." };
  },
};

function onSiteProvider(event: OneMoreEvent): CheckoutProvider {
  return {
    mode: "live",
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
