"use client";

import type { ReactNode } from "react";
import { events } from "@/data/events";
import { eventSeries, hasEventEnded, primaryEventAt } from "@/lib/event-end";
import { formatChapter, formatEventTime, hasPublicDate } from "@/lib/events";
import { useLifecycleInstantFrom } from "@/lib/use-lifecycle";
import type { OneMoreEvent } from "@/types/event";
import { FloatingTicketTab } from "@/components/ticketing/FloatingTicketTab";
import { OneMoreCanvas } from "./OneMoreCanvas";
import { Experience } from "./movements/Experience";
import { LaunchSeries, type SeriesSlot } from "./movements/LaunchSeries";

interface Props {
  /** Build time. The static HTML shows the lead event as of this instant. */
  builtAt: number;
  opening: ReactNode;
  closing: ReactNode;
}

const shortDate = (event: OneMoreEvent) =>
  hasPublicDate(event)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${event.date}T12:00:00Z`))
        .toUpperCase()
    : undefined;

function slotFor(event: OneMoreEvent, lead: OneMoreEvent | undefined, at: Date): SeriesSlot {
  const label = hasEventEnded(event, at)
    ? event.chapter !== undefined
      ? formatChapter(event.chapter)
      : "Past"
    : event.status === "coming-soon"
      ? "Coming soon"
      : (event.eyebrow ?? "Next up");
  const artwork = event.mobileArtwork ?? event.artwork;
  const place = [event.city, event.minimumAge ? `${event.minimumAge}+` : undefined].filter(Boolean).join("  ·  ");
  const facts = artwork.src ? undefined : [shortDate(event), formatEventTime(event), place].filter((fact): fact is string => !!fact);
  return { id: event.id, name: event.name, label, artwork, motif: event.theme.motif, facts, lead: event.id === lead?.id };
}

/**
 * Everything on the homepage that depends on which night leads. It switches by
 * itself at each boundary in the event data (sales close, a night ends), on the
 * site clock, with no deploy or database change.
 */
export function HomeStage({ builtAt, opening, closing }: Props) {
  const instant = useLifecycleInstantFrom(builtAt);
  const at = new Date(instant);
  const lead = primaryEventAt(events, at);
  const series = eventSeries(events).map((event) => slotFor(event, lead, at));

  return (
    <>
      <OneMoreCanvas campaign={lead?.theme ?? null}>
        <main>
          {opening}
          <Experience event={lead} />
          <LaunchSeries series={series} />
          {closing}
        </main>
      </OneMoreCanvas>
      {lead && <FloatingTicketTab key={lead.id} event={lead} />}
    </>
  );
}
