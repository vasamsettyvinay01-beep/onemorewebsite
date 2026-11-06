import type { OneMoreEvent } from "../types/event";

type Counts = Record<string, number>;

/**
 * Live sell-outs applied to the static event. Capacity is counted in tickets sold
 * (a Group of 8 package is one), never in admissions.
 */
export function applyAvailability(event: OneMoreEvent, sold: Counts, held: Counts): OneMoreEvent {
  return {
    ...event,
    ticketTiers: event.ticketTiers.map((t) => {
      if (t.capacity === undefined) return t;
      const paid = sold[t.id] ?? 0;
      const holding = held[t.id] ?? 0;
      return { ...t, soldOut: paid >= t.capacity, unavailable: paid + holding >= t.capacity };
    }),
  };
}
