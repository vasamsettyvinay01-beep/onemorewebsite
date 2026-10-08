import type { OneMoreEvent } from "@/types/event";
import type { CheckoutProvider, CheckoutIntent, CheckoutResult } from "@/types/ticketing";
import { getPurchasableTiers } from "@/lib/events";


/**
 * Checkout provider factory.
 *
 * The site is a static export with no server, so live sales run through
 * Stripe Payment Links: one link per tier, set as `paymentLink` in
 * `src/data/events.ts` (created by `npm run stripe:setup`). Stripe's hosted
 * page collects quantity, name, email and payment (card, Apple Pay, Google
 * Pay), then redirects to /tickets while the webhook issues the QR tickets.
 *
 * Until every purchasable tier of an event has a link the provider is
 * `disabled`: the ticket sheet shows the "COMING SOON" state and never
 * pretends to take money.
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

function paymentLinkProvider(event: OneMoreEvent): CheckoutProvider {
  return {
    mode: "live",
    supportsApplePay: false,
    supportsGooglePay: false,
    collectsPurchaserDetails: true,
    async createCheckout(intent: CheckoutIntent): Promise<CheckoutResult> {
      const tierId = intent.lines[0]?.tierId;
      const tier = event.ticketTiers.find((t) => t.id === tierId);
      if (!tier?.paymentLink) return { ok: false, error: "This ticket isn't available right now." };

      // Stripe allows only alphanumerics, dashes and underscores here.
      const reference = `${event.id}__${tier.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      const url = new URL(tier.paymentLink);
      url.searchParams.set("client_reference_id", reference);
      if (intent.purchaser?.email) url.searchParams.set("prefilled_email", intent.purchaser.email);
      if (intent.promoCode) url.searchParams.set("prefilled_promo_code", intent.promoCode);
      return { ok: true, orderId: reference, redirectUrl: url.toString() };
    },
  };
}

export function getCheckoutProvider(event: OneMoreEvent): CheckoutProvider {
  const tiers = getPurchasableTiers(event);
  if (tiers.length > 0 && tiers.every((t) => t.paymentLink)) return paymentLinkProvider(event);
  return disabledProvider;
}

export function calculateTotalCents(lines: CheckoutIntent["lines"]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
}
