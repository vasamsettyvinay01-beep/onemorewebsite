"use client";

import { useSyncExternalStore } from "react";
import type { OneMoreEvent } from "@/types/event";
import { eventEndsAt } from "@/lib/event-end";

function subscribe(): () => void {
  return () => {};
}

/**
 * Null during server render, then the browser clock. A static page therefore
 * never paints a buy button for a night that is already over.
 */
export function useInstantPassed(iso: string | undefined): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => !!iso && Number.isFinite(Date.parse(iso)) && Date.now() >= Date.parse(iso),
    () => null,
  );
}

export function useNightOver(event: OneMoreEvent | null): boolean | null {
  return useInstantPassed(event ? eventEndsAt(event)?.toISOString() : undefined);
}
