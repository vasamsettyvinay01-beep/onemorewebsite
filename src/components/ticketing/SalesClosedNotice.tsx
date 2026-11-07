import type { OneMoreEvent } from "@/types/event";
import { cn } from "@/lib/cn";

/** Shown in place of every buy control once sales close while the night is still running. */
export function SalesClosedNotice({ event, className, align = "start" }: { event: OneMoreEvent; className?: string; align?: "start" | "center" }) {
  return (
    <div role="status" className={cn(align === "center" && "items-center text-center", className)}>
      <p className="eyebrow text-[0.6rem] tracking-[0.3em] text-[var(--ev-accent,var(--color-gold))]">Ticket sales are now closed</p>
      <p className="mt-3 font-display text-[clamp(1.5rem,4.5vw,2.1rem)] italic leading-tight text-ivory/85">
        {event.name} is currently underway.
      </p>
    </div>
  );
}
