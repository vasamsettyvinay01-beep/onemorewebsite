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

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** UTC instant for a wall-clock time in an IANA timezone. */
function zonedWallTime(date: string, time: string, timeZone: string): Date | undefined {
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
