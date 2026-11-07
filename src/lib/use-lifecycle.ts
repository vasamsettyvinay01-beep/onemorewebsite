"use client";

import { useSyncExternalStore } from "react";
import { events } from "@/data/events";
import type { OneMoreEvent } from "@/types/event";
import { lastBoundary, lifecycleBoundaries, salesPhase, type SalesPhase } from "@/lib/event-end";
import { siteNow, subscribeSiteClock } from "@/lib/site-clock";

const boundaries = lifecycleBoundaries(events);
const current = () => lastBoundary(boundaries, siteNow());

/**
 * The last lifecycle boundary that has passed on the site clock.
 * Null while rendering on the server, so static HTML never paints a buy
 * button for a sale that has already closed.
 */
export function useLifecycleInstant(): number | null {
  return useSyncExternalStore(subscribeSiteClock, current, () => null);
}

/** Same as `useLifecycleInstant`, but renders `builtAt`'s state on the server and while hydrating. */
export function useLifecycleInstantFrom(builtAt: number): number {
  return useSyncExternalStore(subscribeSiteClock, current, () => lastBoundary(boundaries, builtAt));
}

export function useSalesPhase(event: OneMoreEvent | null): SalesPhase | null {
  const instant = useLifecycleInstant();
  if (!event || instant === null) return null;
  return salesPhase(event, new Date(instant));
}
