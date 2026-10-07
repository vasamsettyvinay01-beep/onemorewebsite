import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { getEventFacts, getPriceLabel } from "@/lib/events";
import { cn } from "@/lib/cn";

interface EventFactsProps {
  event: OneMoreEvent;
  className?: string;
}

/**
 * Renders only the facts that exist. Shows "COMING SOON" for anything not yet
 * announced instead of inventing details or fake pricing.
 */
export function EventFacts({ event, className }: EventFactsProps) {
  const facts = getEventFacts(event);
  const price = getPriceLabel(event);
  const announced = facts.length > 0;

  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-[auto_auto]", className)}>
      {announced ? (
        facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="eyebrow text-[0.6rem] text-(--ev-text-muted)">{f.label}</dt>
            <dd className="mt-1.5 text-sm leading-snug font-medium uppercase tracking-[0.14em] text-(--ev-text)">
              {f.value}
            </dd>
          </div>
        ))
      ) : (
        <div className="col-span-2">
          <dt className="eyebrow text-[0.6rem] text-(--ev-text-muted)">Date · Venue · Details</dt>
          <dd className="mt-1.5 text-sm font-medium uppercase tracking-[0.14em] text-(--ev-text)">
            {brand.copy.comingSoon}
          </dd>
        </div>
      )}

      <div className={announced ? "min-w-0" : "col-span-2"}>
        <dt className="eyebrow text-[0.6rem] text-(--ev-text-muted)">Tickets</dt>
        <dd className="mt-1.5 text-sm font-medium uppercase tracking-[0.14em] text-(--ev-text)">
          {event.status === "sold-out" ? "SOLD OUT" : (price ?? brand.copy.comingSoon)}
        </dd>
      </div>
    </dl>
  );
}
