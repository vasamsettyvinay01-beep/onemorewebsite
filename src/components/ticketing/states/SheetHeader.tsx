import type { OneMoreEvent } from "@/types/event";
import { getEventFacts } from "@/lib/events";

/** Shared top block of the ticket sheet: event name + any known facts. */
export function SheetHeader({ event, eyebrow }: { event: OneMoreEvent; eyebrow: string }) {
  const facts = getEventFacts(event);
  return (
    <header aria-hidden className="px-6 pt-6 sm:px-8 sm:pt-8">
      <p className="eyebrow text-(--ev-accent)">{eyebrow}</p>
      <p className="font-headline mt-3 text-[2rem] text-ivory sm:text-[2.5rem]">{event.name}</p>
      {facts.length > 0 && (
        <p className="mt-3 text-[0.7rem] uppercase tracking-[0.16em] text-ivory-muted">
          {facts.map((f) => f.value).join("  ·  ")}
        </p>
      )}
    </header>
  );
}
