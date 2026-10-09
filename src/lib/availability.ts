"use client";

import { useEffect, useMemo, useState } from "react";
import type { OneMoreEvent } from "@/types/event";
import { backendConfigured, functionUrl } from "@/data/backend";

type Sold = Record<string, number>;

/**
 * The event with live sell-outs applied: a tier with a `capacity` is treated
 * as `soldOut` once that many have sold, which also reveals any tier that
 * `opensAfter` it. Falls back to the static data while loading or offline.
 */
export function useLiveEvent(event: OneMoreEvent | null, active: boolean): OneMoreEvent | null {
  const [sold, setSold] = useState<{ eventId: string; sold: Sold } | null>(null);
  const eventId = event?.id;
  const capped = !!event?.ticketTiers.some((t) => t.capacity !== undefined);

  useEffect(() => {
    if (!active || !eventId || !capped || !backendConfigured) return;
    let cancelled = false;
    fetch(`${functionUrl("availability")}?event=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { sold: Sold } | null) => {
        if (!cancelled && body) setSold({ eventId, sold: body.sold });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, eventId, capped]);

  return useMemo(() => {
    if (!event || !sold || sold.eventId !== event.id) return event;
    return {
      ...event,
      ticketTiers: event.ticketTiers.map((t) =>
        t.capacity !== undefined && (sold.sold[t.id] ?? 0) >= t.capacity ? { ...t, soldOut: true } : t,
      ),
    };
  }, [event, sold]);
}
