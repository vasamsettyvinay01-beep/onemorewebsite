import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { getEventFacts } from "@/lib/events";
import { cn } from "@/lib/cn";

interface EventFactsProps {
  event: OneMoreEvent;
  className?: string;
}

/**
 * Renders only the facts that exist. Shows "COMING SOON" for anything not yet
 * announced instead of inventing details. Pricing lives behind the ticket CTA.
 */
export function EventFacts({ event, className }: EventFactsProps) {
  const facts = getEventFacts(event);

  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-[auto_auto]", className)}>
      {facts.length > 0 ? (
        facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="eyebrow text-[0.6rem] text-(--ev-text-muted)">{f.label}</dt>
            <dd className="mt-1.5 text-sm font-medium uppercase leading-snug tracking-[0.14em] text-(--ev-text)">
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
    </dl>
  );
}
