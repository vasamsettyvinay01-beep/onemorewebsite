import type { OneMoreEvent } from "@/types/event";
import { formatChapter, getEventFacts } from "@/lib/events";

/** Shared top block of the ticket sheet: chapter, event name + any known facts. */
export function SheetHeader({ event, eyebrow }: { event: OneMoreEvent; eyebrow: string }) {
  const facts = getEventFacts(event);
  return (
    <header aria-hidden className="px-6 pt-5 sm:px-8 md:px-10 md:pt-0">
      <p className="eyebrow flex items-center gap-3 text-(--ev-accent)">
        {event.chapter !== undefined && (
          <>
            <span>{formatChapter(event.chapter, true)}</span>
            <span className="h-px w-6 bg-current opacity-60" />
          </>
        )}
        <span>{eyebrow}</span>
      </p>
      <p className="font-display mt-3 text-[2.25rem] leading-[0.92] text-ivory md:text-[2.75rem]">{event.name}</p>
      {facts.length > 0 && (
        <p className="mt-3 text-[0.66rem] uppercase tracking-[0.1em] text-ivory-muted sm:text-[0.7rem] sm:tracking-[0.16em]">
          {facts.map((f) => f.value).join("  ·  ")}
        </p>
      )}
    </header>
  );
}
