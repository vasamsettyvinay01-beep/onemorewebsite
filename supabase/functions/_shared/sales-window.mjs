// When public checkout stops taking new bookings, per event, as UTC instants.
// Mirrors `saleEnd` (America/Chicago wall time) in src/data/events.ts;
// scripts/sales-window.test.mjs keeps the two equal.
//
// The function's own clock decides. Nothing the browser sends can reopen sales.
// Already-created PaymentIntents, the webhook, tickets, the door, refunds and
// admin operations do not read this.

export const SALES_CLOSE_AT = Object.freeze({
  // Diwali Night: Sunday 2026-11-08 01:00 CST, one hour before the night ends.
  evt_diwali_night: "2026-11-08T07:00:00.000Z",
});

export const SALES_CLOSED_MESSAGE = "Ticket sales are now closed.";

export function salesWindowClosed(eventId, now = Date.now()) {
  const close = SALES_CLOSE_AT[eventId];
  if (!close) return false;
  return now >= Date.parse(close);
}
