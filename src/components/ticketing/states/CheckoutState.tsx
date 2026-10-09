"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { OneMoreEvent, TicketTier } from "@/types/event";
import type { CheckoutProvider, OrderConfirmation, PaymentMethod } from "@/types/ticketing";
import { calculateTotalCents } from "@/lib/checkout";
import { formatEventDate, formatEventPlace, formatMoney, getPurchasableTiers, getStartingTier } from "@/lib/events";
import { Button } from "@/components/ui/Button";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  provider: CheckoutProvider;
  onClose: () => void;
  onConfirmed: (confirmation: OrderConfirmation) => void;
}

/**
 * The fast-checkout UI: tier → quantity → name → email → pay.
 * When the provider collects purchaser details (the on-site /checkout page)
 * it is just tier → continue, and that page collects the rest.
 * Only rendered when a live CheckoutProvider is configured. It never
 * generates tickets itself; confirmation must come from the server after a
 * verified payment (webhook), which `provider.createCheckout` is expected to
 * orchestrate.
 */
export function CheckoutState({ event, provider, onClose, onConfirmed }: Props) {
  const tiers = getPurchasableTiers(event);
  const [tier, setTier] = useState<TicketTier>(getStartingTier(event) ?? tiers[0]);
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Back from the checkout page can restore this page from bfcache mid-"Processing…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setSubmitting(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const maxQty = tier.maxPerOrder ?? 8;
  const lines = useMemo(
    () => [{ tierId: tier.id, quantity, unitPriceCents: tier.priceCents }],
    [tier, quantity],
  );
  const total = calculateTotalCents(lines);
  const totalLabel = formatMoney(total, tier.currency);
  const hosted = provider.collectsPurchaserDetails;
  const valid = hosted || (name.trim().length > 1 && /.+@.+\..+/.test(email));

  async function pay(method: PaymentMethod, e?: FormEvent) {
    e?.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(method);
    setError(null);
    const result = await provider.createCheckout({
      eventId: event.id,
      lines,
      purchaser: hosted ? undefined : { name: name.trim(), email: email.trim() },
    });
    if (!result.ok) {
      setSubmitting(null);
      setError(result.error);
      return;
    }
    if (result.redirectUrl) {
      // Stay in "Processing…" while the browser leaves for the hosted page.
      window.location.assign(result.redirectUrl);
      return;
    }
    setSubmitting(null);
    // A live provider will resolve this only after server-side verification.
    onConfirmed({
      orderId: result.orderId,
      eventName: event.name,
      ticketCount: quantity,
      email: email.trim(),
      chapter: event.chapter,
      dateLabel: formatEventDate(event),
      placeLabel: formatEventPlace(event),
      holderName: name.trim(),
      tierName: tier.name,
    });
  }

  const field =
    "h-12 w-full border-b border-ivory/20 bg-transparent px-0 font-sans text-base text-ivory placeholder:text-ivory/30 focus:border-(--ev-accent) focus:outline-none";

  return (
    <form className="flex flex-col" onSubmit={(e) => pay("card", e)} noValidate>
      <SheetHeader event={event} eyebrow="Tickets" />

      {/* Tier */}
      <div className="mx-6 mt-7 border-y border-ivory/10 py-5 sm:mx-8">
        {tiers.length > 1 ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="eyebrow mb-2 text-ivory-muted">Ticket</legend>
            {tiers.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center justify-between gap-4">
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="tier"
                    className="accent-(--ev-accent)"
                    checked={t.id === tier.id}
                    onChange={() => setTier(t)}
                  />
                  <span className="text-sm uppercase tracking-[0.18em]">{t.name}</span>
                </span>
                <span className="font-display text-2xl">{formatMoney(t.priceCents, t.currency)}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="flex items-end justify-between">
            <span className="text-sm uppercase tracking-[0.18em]">{tier.name}</span>
            <span className="font-display text-3xl">{formatMoney(tier.priceCents, tier.currency)}</span>
          </div>
        )}

        {/* Quantity */}
        {!hosted && (
          <div className="mt-6 flex items-center justify-between">
            <span className="eyebrow text-ivory-muted">Quantity</span>
            <div className="flex items-center gap-6">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="flex size-11 items-center justify-center rounded-full border border-ivory/20 text-xl text-ivory transition-colors hover:border-(--ev-accent)"
              >
                −
              </button>
              <span aria-live="polite" className="w-6 text-center font-display text-3xl">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                className="flex size-11 items-center justify-center rounded-full border border-ivory/20 text-xl text-ivory transition-colors hover:border-(--ev-accent)"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Purchaser */}
      {!hosted && (
        <div className="flex flex-col gap-5 px-6 pt-6 sm:px-8">
          <label className="block">
            <span className="eyebrow text-ivory-muted">Name</span>
            <input
              data-autofocus=""
              className={field}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="eyebrow text-ivory-muted">Email</span>
            <input
              className={field}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        </div>
      )}
      {hosted && (
        <p className="px-6 pt-5 text-[0.78rem] leading-relaxed text-ivory-muted sm:px-8">
          Choose how many on the next page and pay by card, Apple Pay or Google Pay. Your QR passes appear the
          moment you book and land in your inbox.
        </p>
      )}
      {error && (
        <p role="alert" className="px-6 pt-4 text-sm text-(--ev-accent) sm:px-8">
          {error}
        </p>
      )}

      {/* Pay */}
      <div className="flex flex-col gap-3 px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
        {provider.supportsApplePay && (
          <Button variant="ivory" size="lg" className="w-full" disabled={!valid || !!submitting} onClick={() => pay("apple-pay")}>
            Apple Pay
          </Button>
        )}
        {provider.supportsGooglePay && (
          <Button variant="ivory" size="lg" className="w-full" disabled={!valid || !!submitting} onClick={() => pay("google-pay")}>
            Google Pay
          </Button>
        )}
        <Button type="submit" variant="event" size="lg" className="w-full" disabled={!valid || !!submitting}>
          {submitting ? "Processing…" : hosted ? "Continue to payment" : `Pay ${totalLabel}`}
        </Button>
        <Button variant="ghost" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    </form>
  );
}
