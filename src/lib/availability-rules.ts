import type { OneMoreEvent } from "../types/event";

type Counts = Record<string, number>;

/** People already sold or held against the online admission cap. */
export type OnlineRoom = { cap: number; committed: number };

/**
 * Live sell-outs applied to the static event. A tier `capacity` is counted in
 * packages sold (a Group of 8 package is one). The online room is counted in
 * people: once `committed` reaches `cap`, every public pass is sold out.
 */
export function applyAvailability(
  event: OneMoreEvent,
  sold: Counts,
  held: Counts,
  online?: OnlineRoom | null,
): OneMoreEvent {
  const tiers = event.ticketTiers.map((t) => {
    if (t.capacity === undefined) return t;
    const paid = sold[t.id] ?? 0;
    const holding = held[t.id] ?? 0;
    return { ...t, soldOut: paid >= t.capacity, unavailable: paid + holding >= t.capacity };
  });
  const roomFull = !!online && online.cap > 0 && online.committed >= online.cap;
  if (!roomFull) return { ...event, ticketTiers: tiers };
  return {
    ...event,
    status: "sold-out",
    ticketTiers: tiers.map((t) => (t.hidden || t.priceOnRequest ? t : { ...t, soldOut: true, unavailable: true })),
  };
}
