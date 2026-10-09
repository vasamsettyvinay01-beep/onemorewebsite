"use client";

import { useState, type FormEvent } from "react";
import type { OneMoreEvent, TicketTier } from "@/types/event";
import type { CheckoutProvider } from "@/types/ticketing";
import { formatMoney, getPurchasableTiers, getStartingTier } from "@/lib/events";
import { Button } from "@/components/ui/Button";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  provider: CheckoutProvider;
  onClose: () => void;
}

/** Tier picker. Quantity, name, email and payment happen on /checkout. */
export function CheckoutState({ event, provider, onClose }: Props) {
  const tiers = getPurchasableTiers(event);
  const [tier, setTier] = useState<TicketTier>(getStartingTier(event) ?? tiers[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueToCheckout(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await provider.createCheckout({
      eventId: event.id,
      lines: [{ tierId: tier.id, quantity: 1, unitPriceCents: tier.priceCents }],
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    if (result.redirectUrl) window.location.assign(result.redirectUrl);
  }

  return (
    <form className="flex flex-col" onSubmit={continueToCheckout} noValidate>
      <SheetHeader event={event} eyebrow="Tickets" />

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
      </div>

      <p className="px-6 pt-5 text-[0.78rem] leading-relaxed text-ivory-muted sm:px-8">
        Choose how many on the next page and pay by card, Apple Pay or Google Pay. Your QR passes appear the moment
        you book and land in your inbox.
      </p>
      {error && (
        <p role="alert" className="px-6 pt-4 text-sm text-(--ev-accent) sm:px-8">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
        <Button type="submit" variant="event" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Processing…" : "Continue to payment"}
        </Button>
        <Button variant="ghost" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    </form>
  );
}
