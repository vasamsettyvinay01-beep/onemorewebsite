"use client";

import { useState, type FormEvent } from "react";
import type { OneMoreEvent, TicketTier } from "@/types/event";
import type { CheckoutProvider } from "@/types/ticketing";
import { formatMoney, getStartingTier, getVisibleTiers } from "@/lib/events";
import { Button } from "@/components/ui/Button";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  provider: CheckoutProvider;
  onClose: () => void;
}

/** Tier picker. Quantity, name, email and payment happen on /checkout. */
export function CheckoutState({ event, provider }: Props) {
  const tiers = getVisibleTiers(event).filter((t) => !t.priceOnRequest);
  const [tier, setTier] = useState<TicketTier>(getStartingTier(event) ?? tiers.find((t) => !t.soldOut) ?? tiers[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueToCheckout(e: FormEvent) {
    e.preventDefault();
    if (submitting || tier.soldOut || tier.unavailable) return;
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
    <form className="flex h-full min-h-0 flex-col" onSubmit={continueToCheckout} noValidate>
      <SheetHeader event={event} eyebrow="Tickets" compact />

      <div className="mx-6 mt-4 flex min-h-0 flex-1 flex-col border-y border-ivory/10 py-2 sm:mx-8">
        {tiers.length > 1 ? (
          <fieldset className="flex min-h-0 flex-1 flex-col justify-evenly">
            <legend className="eyebrow mb-1 text-ivory-muted">Ticket</legend>
            {tiers.map((t) => {
              const gone = !!t.soldOut || !!t.unavailable;
              return (
              <label key={t.id} className={`flex items-center justify-between gap-4 ${gone ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="tier"
                    className="size-3.5 accent-(--ev-accent)"
                    checked={!gone && t.id === tier.id}
                    disabled={gone}
                    onChange={() => setTier(t)}
                  />
                  <span className={`text-[0.78rem] uppercase tracking-[0.16em] ${gone ? "text-ivory/35" : ""}`}>
                    {t.name}
                    {gone && <span className="ml-2 font-semibold tracking-[0.14em] text-(--ev-accent)">Sold out</span>}
                  </span>
                </span>
                <span className={`font-display text-xl leading-none ${gone ? "text-ivory/30 line-through" : ""}`}>
                  {formatMoney(t.priceCents, t.currency)}
                </span>
              </label>
              );
            })}
          </fieldset>
        ) : (
          <div className="flex items-end justify-between">
            <span className="text-sm uppercase tracking-[0.18em]">{tier.name}</span>
            <span className="font-display text-3xl">{formatMoney(tier.priceCents, tier.currency)}</span>
          </div>
        )}
      </div>

      <div className="px-6 pt-4 sm:px-8">
        <p className="text-[0.72rem] leading-snug text-ivory-muted">Your pass arrives the moment you book.</p>
        {error && (
          <p role="alert" className="pt-2 text-sm text-(--ev-accent)">
            {error}
          </p>
        )}
        <Button type="submit" variant="event" size="lg" className="mt-3 w-full" disabled={submitting || tier.soldOut || tier.unavailable}>
          {submitting ? "Processing…" : "Continue to payment"}
        </Button>
      </div>
    </form>
  );
}
