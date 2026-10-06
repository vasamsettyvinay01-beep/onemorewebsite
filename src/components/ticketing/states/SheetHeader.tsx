import type { OneMoreEvent } from "@/types/event";
import { formatChapter, getEventFacts } from "@/lib/events";

/** Shared top block of the ticket sheet: chapter, event name + any known facts. */
export function SheetHeader({ event, eyebrow }: { event: OneMoreEvent; eyebrow: string }) {
  const facts = getEventFacts(event);
  return (
    <header aria-hidden className="px-6 pt-6 sm:px-8 sm:pt-8 md:px-10 md:pt-12">
      <p className="eyebrow flex items-center gap-3 text-(--ev-accent)">
        {event.chapter !== undefined && (
          <>
            <span>{formatChapter(event.chapter, true)}</span>
            <span className="h-px w-6 bg-current opacity-60" />
          </>
        )}
        <span>{eyebrow}</span>
      </p>
      <p className="font-display mt-4 text-[2.75rem] leading-[0.92] text-ivory sm:text-[3.25rem]">{event.name}</p>
      {facts.length > 0 && (
        <p className="mt-4 text-[0.7rem] uppercase tracking-[0.16em] text-ivory-muted">
          {facts.map((f) => f.value).join("  ·  ")}
        </p>
      )}
    </header>
  );
}
