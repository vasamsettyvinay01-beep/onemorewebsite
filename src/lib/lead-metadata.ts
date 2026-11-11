import { brand } from "@/data/brand";
import { hasPublicDate } from "@/lib/events";
import type { OneMoreEvent } from "@/types/event";

export interface LeadMetadata {
  title: string;
  description: string;
}

const longDate = (event: OneMoreEvent) =>
  hasPublicDate(event)
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${event.date}T12:00:00Z`),
      )
    : undefined;

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Homepage title and description while an announced night leads the page.
 * Built from date, time, city and age only — never the venue, which may not be public.
 * Null keeps the brand metadata.
 */
export function leadMetadata(event: OneMoreEvent | undefined): LeadMetadata | null {
  if (!event || event.status !== "coming-soon") return null;
  const time = event.startTime ? `${clock(event.startTime)}${event.endTime ? ` – ${clock(event.endTime)}` : ""}` : undefined;
  const facts = [event.city, longDate(event), time, event.minimumAge ? `${event.minimumAge}+` : undefined].filter(Boolean).join(" · ");
  return {
    title: `ONE MORE — ${event.name}`,
    description: `${event.name} by ${brand.name}.${facts ? ` ${facts}.` : ""} Tickets coming soon.`,
  };
}
