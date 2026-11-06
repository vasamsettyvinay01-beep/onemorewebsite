"use client";

import { useEffect, useMemo, useState } from "react";
import type { OneMoreEvent } from "@/types/event";
import { backendConfigured, functionUrl } from "@/data/backend";
import { applyAvailability } from "@/lib/availability-rules";

type Counts = Record<string, number>;

/**
 * The event with live sell-outs applied: a tier with a `capacity` is treated
 * as `soldOut` once that many have sold. Passes that wait on it then unlock.
 * Falls back to the static data while loading or offline.
 */
export function useLiveEvent(event: OneMoreEvent | null, active: boolean): OneMoreEvent | null {
  const [sold, setSold] = useState<{ eventId: string; sold: Counts; held: Counts } | null>(null);
  const eventId = event?.id;
  const capped = !!event?.ticketTiers.some((t) => t.capacity !== undefined);

  useEffect(() => {
    if (!active || !eventId || !capped || !backendConfigured) return;
    let cancelled = false;
    fetch(`${functionUrl("availability")}?event=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { sold?: Counts; held?: Counts } | null) => {
        if (!cancelled && body?.sold) setSold({ eventId, sold: body.sold, held: body.held ?? {} });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, eventId, capped]);

  return useMemo(() => {
    if (!event || !sold || sold.eventId !== event.id) return event;
    return applyAvailability(event, sold.sold, sold.held);
  }, [event, sold]);
}
