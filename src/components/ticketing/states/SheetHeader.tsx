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
  const when = facts.filter((f) => f.label === "DATE" || f.label === "TIME").map((f) => f.value);
  const where = facts.filter((f) => f.label === "WHERE" || f.label === "AGE").map((f) => f.value);
  return (
    <header aria-hidden className="px-6 pt-3 sm:px-8 md:px-8 md:pt-1">
      <p className="eyebrow flex items-center gap-3 text-gold-soft">
        {event.chapter !== undefined && (
          <>
            <span>{formatChapter(event.chapter, true)}</span>
            <span className="h-px w-6 bg-current opacity-60" />
          </>
        )}
        <span>{eyebrow}</span>
      </p>
      <p
        className={
          compact
            ? "mt-2.5 font-event text-[2.35rem] text-ivory md:text-[2.65rem]"
            : "mt-3 font-event text-[2.55rem] text-ivory md:text-[3rem]"
        }
      >
        {event.name}
      </p>
      {(when.length > 0 || where.length > 0) && (
        <div className={compact ? "mt-3 space-y-1" : "mt-4 space-y-1.5"}>
          {when.length > 0 && (
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-ivory/55">{when.join("  ·  ")}</p>
          )}
          {where.length > 0 && (
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-ivory/38">{where.join("  ·  ")}</p>
          )}
        </div>
      )}
    </header>
  );
}
