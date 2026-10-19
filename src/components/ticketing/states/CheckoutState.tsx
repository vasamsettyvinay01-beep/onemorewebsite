"use client";

import { useState, type FormEvent } from "react";
import type { OneMoreEvent, TicketTier } from "@/types/event";
import type { CheckoutProvider } from "@/types/ticketing";
import { formatMoney, getStartingTier, getVisibleTiers, waitingFor } from "@/lib/events";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  provider: CheckoutProvider;
  onClose: () => void;
}

/** Tier picker. Quantity, name, email and payment happen on /checkout. */
export function CheckoutState({ event, provider }: Props) {
  const visibleTiers = getVisibleTiers(event);
  const tiers = visibleTiers.filter((t) => !t.priceOnRequest);
  const inquiryTiers = visibleTiers.filter((t) => t.priceOnRequest);
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

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 [scrollbar-color:rgba(187,155,99,0.4)_transparent] [scrollbar-width:thin] sm:px-8">
        {tiers.length > 1 ? (
          <div role="radiogroup" aria-label="Ticket" className="border-t border-ivory/10 pb-1">
            {tiers.map((t) => {
              const gone = !!t.soldOut || !!t.unavailable;
              const opensAfter = waitingFor(event, t);
              const closed = gone || !!opensAfter;
              const selected = !closed && t.id === tier.id;
              return (
                <label
                  key={t.id}
                  className={cn(
                    "group relative flex items-baseline justify-between gap-6 border-b border-ivory/[0.08] py-3 pl-4 pr-0.5 transition-colors duration-500",
                    closed ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-3 left-0 top-3 w-px bg-gold transition-opacity duration-500",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <input
                    type="radio"
                    name="tier"
                    className="sr-only"
                    checked={selected}
                    disabled={closed}
                    onChange={() => setTier(t)}
                  />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[0.7rem] font-medium uppercase tracking-[0.2em] transition-colors duration-500",
                        closed ? "text-ivory/28" : selected ? "text-ivory" : "text-ivory/48 group-hover:text-ivory/75",
                        "group-has-[:focus-visible]:text-ivory",
                      )}
                    >
                      {t.name}
                    </span>
                    {gone && <span className="mt-1 block text-[0.6rem] uppercase tracking-[0.16em] text-gold/70">Sold out</span>}
                    {!gone && opensAfter && (
                      <span className="mt-1 block text-[0.6rem] uppercase tracking-[0.16em] text-ivory/38">After {opensAfter}</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[0.92rem] tabular-nums tracking-[0.03em] transition-colors duration-500",
                      gone ? "text-ivory/25 line-through" : selected ? "text-gold-soft" : "text-ivory/40 group-hover:text-ivory/60",
                    )}
                  >
                    {formatMoney(t.priceCents, t.currency)}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="flex items-end justify-between border-y border-ivory/10 py-5">
            <span className="text-[0.72rem] font-medium uppercase tracking-[0.18em]">{tier.name}</span>
            <span className="text-2xl tabular-nums tracking-[0.04em] text-gold-soft">{formatMoney(tier.priceCents, tier.currency)}</span>
          </div>
        )}

        {inquiryTiers.map((requestTier) => {
          const subject = `${event.name} ${requestTier.name} enquiry`;
          const message = `Hi, I would like to enquire about ${requestTier.name} for ${event.name}.`;
          const whatsapp = requestTier.inquiryWhatsApp?.replace(/\D/g, "");
          return (
            <section
              key={requestTier.id}
              className="mt-5 border border-gold/55 bg-gold/[0.08] px-4 py-4 shadow-[0_0_32px_-18px_rgba(187,155,99,0.85)]"
              aria-labelledby={`${requestTier.id}-title`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-gold">On request</p>
                  <h3 id={`${requestTier.id}-title`} className="mt-1 font-display text-[1.65rem] italic leading-none text-ivory">
                    {requestTier.name}
                  </h3>
                </div>
                <span className="mt-1 size-2 shrink-0 rotate-45 border border-gold" aria-hidden />
              </div>
              <p className="mt-3 max-w-[38ch] text-[0.72rem] leading-relaxed text-ivory/65">
                {requestTier.description ?? "Contact our team for availability and reservations."}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {requestTier.inquiryEmail && (
                  <a
                    href={`mailto:${requestTier.inquiryEmail}?subject=${encodeURIComponent(subject)}`}
                    className="flex h-10 items-center justify-center border border-gold/50 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-gold transition-colors hover:bg-gold hover:text-rich"
                  >
                    Email us
                  </a>
                )}
                {whatsapp && (
                  <a
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-10 items-center justify-center bg-gold text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-rich transition-colors hover:bg-gold-soft"
                  >
                    WhatsApp us
                  </a>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="relative z-10 shrink-0 bg-[#0c0b0a] px-6 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
        <p className="text-[0.72rem] leading-relaxed tracking-[0.01em] text-ivory/45">Your pass arrives the moment you book.</p>
        {error && (
          <p role="alert" className="pt-2 text-sm text-gold-soft">
            {error}
          </p>
        )}
        <Button type="submit" variant="gold" size="lg" arrow className="mt-4 w-full" disabled={submitting || tier.soldOut || tier.unavailable}>
          {submitting ? "Processing…" : "Continue to payment"}
        </Button>
      </div>
    </form>
  );
}
