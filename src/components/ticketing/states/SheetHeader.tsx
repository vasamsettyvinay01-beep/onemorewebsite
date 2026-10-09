import type { OneMoreEvent } from "@/types/event";
import { formatChapter, getEventFacts } from "@/lib/events";

/** Shared top block of the ticket sheet: chapter, event name + any known facts. */
export function SheetHeader({
  event,
  eyebrow,
  omitPlace = false,
  compact = false,
}: {
  event: OneMoreEvent;
  eyebrow: string;
  /** Leave the venue out when the caller shows it on its own line. */
  omitPlace?: boolean;
  /** Tighter type so a full price list fits the sheet without scrolling. */
  compact?: boolean;
}) {
  const facts = getEventFacts(event).filter((f) => !(omitPlace && f.label === "WHERE"));
  return (
    <header aria-hidden className="px-6 pt-4 sm:px-8 md:px-8 md:pt-0">
      <p className="eyebrow flex items-center gap-3 text-(--ev-accent)">
        {event.chapter !== undefined && (
          <>
            <span>{formatChapter(event.chapter, true)}</span>
            <span className="h-px w-6 bg-current opacity-60" />
          </>
        )}
        <span>{eyebrow}</span>
      </p>
      <p className={compact ? "mt-2 font-display text-[1.85rem] leading-[0.92] text-ivory md:text-[2.15rem]" : "mt-3 font-display text-[2.25rem] leading-[0.92] text-ivory md:text-[2.75rem]"}>
        {event.name}
      </p>
      {facts.length > 0 && (
        <p className="mt-2 text-[0.62rem] uppercase tracking-[0.12em] text-ivory-muted sm:text-[0.68rem] sm:tracking-[0.14em]">
          {facts.map((f) => f.value).join("  ·  ")}
        </p>
      )}
    </header>
  );
}
