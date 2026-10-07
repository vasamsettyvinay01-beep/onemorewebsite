import { events } from "@/data/events";
import type { OneMoreEvent, TicketTier } from "@/types/event";

/** The single event surfaced as "NEXT UP". Falls back to the first non-past event. */
export function getFeaturedEvent(): OneMoreEvent | undefined {
  return (
    events.find((e) => e.featured && e.status !== "draft" && e.status !== "past") ??
    events.find((e) => e.status !== "draft" && e.status !== "past")
  );
}

export function getEventBySlug(slug: string): OneMoreEvent | undefined {
  return events.find((e) => e.slug === slug);
}

export function isOnSale(event: OneMoreEvent): boolean {
  return event.status === "on-sale" && getPurchasableTiers(event).length > 0;
}

/** Tiers shown publicly: not hidden, and any tier they wait on has sold out. */
export function getVisibleTiers(event: OneMoreEvent): TicketTier[] {
  return event.ticketTiers.filter((t) => {
    if (t.hidden) return false;
    if (!t.opensAfter) return true;
    return event.ticketTiers.find((o) => o.id === t.opensAfter)?.soldOut ?? true;
  });
}

/** Tiers that can be bought right now at a fixed price. */
export function getPurchasableTiers(event: OneMoreEvent): TicketTier[] {
  return getVisibleTiers(event).filter((t) => !t.priceOnRequest && !t.soldOut);
}

export function getStartingTier(event: OneMoreEvent): TicketTier | undefined {
  return [...getPurchasableTiers(event)].sort((a, b) => a.priceCents - b.priceCents)[0];
}

export function formatTierPrice(tier: TicketTier): string {
  return tier.priceOnRequest ? "On request" : formatMoney(tier.priceCents, tier.currency);
}

export function formatMoney(cents: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatEventDate(event: OneMoreEvent, locale = "en-US"): string | undefined {
  if (!event.date) return undefined;
  const date = new Date(`${event.date}T12:00:00`);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
    .format(date)
    .toUpperCase();
}

function formatTime(time: string, locale = "en-US"): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: m ? "2-digit" : undefined })
    .format(d)
    .replace(" ", "")
    .toUpperCase();
}

export function formatEventTime(event: OneMoreEvent): string | undefined {
  if (!event.startTime) return undefined;
  const start = formatTime(event.startTime);
  return event.endTime ? `${start} – ${formatTime(event.endTime)}` : start;
}

export function formatEventPlace(event: OneMoreEvent): string | undefined {
  const city = event.city ?? event.venue?.city;
  if (event.venue?.name && city) return `${event.venue.name} · ${city}`;
  return event.venue?.name ?? city;
}

/** "CH. 01" (short) or "CHAPTER 01". */
export function formatChapter(chapter: number, short = false): string {
  return `${short ? "CH." : "CHAPTER"} ${String(chapter).padStart(2, "0")}`;
}

export interface EventFact {
  label: string;
  value: string;
}

/** Only facts that actually exist. Nothing is invented. */
export function getEventFacts(event: OneMoreEvent): EventFact[] {
  const facts: EventFact[] = [];
  const date = formatEventDate(event);
  const time = formatEventTime(event);
  const place = formatEventPlace(event);
  if (date) facts.push({ label: "DATE", value: date });
  if (time) facts.push({ label: "TIME", value: time });
  if (place) facts.push({ label: "WHERE", value: place });
  if (event.minimumAge) facts.push({ label: "AGE", value: `${event.minimumAge}+` });
  return facts;
}
