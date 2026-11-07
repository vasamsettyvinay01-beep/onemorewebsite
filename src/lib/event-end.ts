import type { OneMoreEvent } from "@/types/event";

/**
 * The instant the night is over, in UTC.
 * An end clock earlier than the start belongs to the next morning
 * (21:00–02:00 ends at 02:00 the following day).
 */
export function eventEndsAt(event: Pick<OneMoreEvent, "date" | "startTime" | "endTime" | "timezone">): Date | undefined {
  if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return undefined;
  const zone = event.timezone || "America/Chicago";
  const endTime = event.endTime && /^\d{2}:\d{2}$/.test(event.endTime) ? event.endTime : "23:59";
  const crossesMidnight = !!event.startTime && !!event.endTime && event.endTime < event.startTime;
  const endDate = crossesMidnight ? addIsoDays(event.date, 1) : event.date;
  return zonedWallTime(endDate, endTime, zone);
}

export function hasEventEnded(
  event: Pick<OneMoreEvent, "date" | "startTime" | "endTime" | "timezone">,
  now: Date = new Date(),
): boolean {
  const ends = eventEndsAt(event);
  return !!ends && now.getTime() >= ends.getTime();
}

type Timed = Pick<OneMoreEvent, "date" | "startTime" | "endTime" | "timezone" | "saleEnd">;

/** When public checkout stops taking new bookings: `saleEnd` if set, never later than the end of the night. */
export function salesCloseAt(event: Timed): Date | undefined {
  const ends = eventEndsAt(event);
  const match = event.saleEnd?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  const cutoff = match ? zonedWallTime(match[1], match[2], event.timezone || "America/Chicago") : undefined;
  if (cutoff && ends) return cutoff.getTime() < ends.getTime() ? cutoff : ends;
  return cutoff ?? ends;
}

/**
 * open   — public checkout takes new bookings
 * closed — the night is still running, but new bookings are refused
 * ended  — the night is over
 */
export type SalesPhase = "open" | "closed" | "ended";

export function salesPhase(event: Timed, now: Date): SalesPhase {
  if (hasEventEnded(event, now)) return "ended";
  const close = salesCloseAt(event);
  return close && now.getTime() >= close.getTime() ? "closed" : "open";
}

type Listed = Timed & Pick<OneMoreEvent, "status">;

function isPublic(event: Listed): boolean {
  return event.status !== "draft" && event.status !== "cancelled";
}

function startKey(event: Listed): string {
  return `${event.date ?? "9999-12-31"}T${event.startTime ?? "00:00"}`;
}

/** Public events in date order. Past nights stay listed as earlier chapters. */
export function eventSeries<T extends Listed>(list: readonly T[]): T[] {
  return list.filter(isPublic).sort((a, b) => startKey(a).localeCompare(startKey(b)));
}

/** The homepage's lead event: the earliest public night that is not over yet. */
export function primaryEventAt<T extends Listed>(list: readonly T[], now: Date): T | undefined {
  return eventSeries(list).find((event) => event.status !== "past" && !hasEventEnded(event, now));
}

/** Every instant at which some event changes phase, ascending. */
export function lifecycleBoundaries(list: readonly Timed[]): number[] {
  const instants = list.flatMap((event) => [salesCloseAt(event), eventEndsAt(event)]);
  const ms = instants.filter((at): at is Date => !!at).map((at) => at.getTime());
  return [...new Set(ms)].sort((a, b) => a - b);
}

/**
 * The latest boundary at or before `now`, or 0 before the first one.
 * Every phase decision is constant between two boundaries, so this single
 * number stands in for the clock without re-rendering on every tick.
 */
export function lifecycleInstant(list: readonly Timed[], now: number): number {
  return lastBoundary(lifecycleBoundaries(list), now);
}

export function lastBoundary(boundaries: readonly number[], now: number): number {
  let passed = 0;
  for (const at of boundaries) if (now >= at) passed = at;
  return passed;
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** UTC instant for a wall-clock time in an IANA timezone. */
export function zonedWallTime(date: string, time: string, timeZone: string): Date | undefined {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return undefined;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wall;
  for (let pass = 0; pass < 2; pass += 1) utc = wall - zoneOffsetMs(timeZone, utc);
  return new Date(utc);
}

function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = value("hour") === 24 ? 0 : value("hour");
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), hour, value("minute"), value("second"));
  return asUtc - instant;
}
