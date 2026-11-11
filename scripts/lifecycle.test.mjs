import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { events } from "../src/data/events.ts";
import {
  eventEndsAt,
  lastBoundary,
  lifecycleBoundaries,
  primaryEventAt,
  salesCloseAt,
  salesPhase,
  eventSeries,
} from "../src/lib/event-end.ts";
import { SALES_CLOSE_AT, SALES_CLOSED_MESSAGE, salesWindowClosed } from "../supabase/functions/_shared/sales-window.mjs";

const diwali = events.find((event) => event.slug === "diwali-night");
const newYear = events.find((event) => event.slug === "new-year-night");
if (!diwali || !newYear) throw new Error("Diwali Night and New Year Night must both be listed");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// The three simulated moments, America/Chicago (CST, UTC-6, after DST ended on Nov 1).
const NOV7_11PM = new Date("2026-11-07T23:00:00-06:00");
const NOV8_115AM = new Date("2026-11-08T01:15:00-06:00");
const NOV8_201AM = new Date("2026-11-08T02:01:00-06:00");

test("Diwali sales closed at 10:00 PM and the night ends at 2:00 AM Chicago", () => {
  assert.equal(salesCloseAt(diwali)?.toISOString(), "2026-11-08T04:00:00.000Z");
  assert.equal(eventEndsAt(diwali)?.toISOString(), "2026-11-08T08:00:00.000Z");
});

test("New Year Night runs Jan 1 2027, 9 PM to 2 AM Chicago, 21+", () => {
  assert.equal(newYear.name, "New Year Night");
  assert.equal(newYear.date, "2027-01-01");
  assert.equal(newYear.startTime, "21:00");
  assert.equal(newYear.endTime, "02:00");
  assert.equal(newYear.timezone, "America/Chicago");
  assert.equal(newYear.minimumAge, 21);
  assert.equal(eventEndsAt(newYear)?.toISOString(), "2027-01-02T08:00:00.000Z");
});

test("New Year Night's date is kept for the lifecycle but hidden from the public site", () => {
  assert.equal(newYear.date, "2027-01-01");
  assert.equal(newYear.dateHidden, true);
  assert.notEqual(diwali.dateHidden, true);
});

test("New Year Night has no venue, no tiers and no checkout", () => {
  assert.equal(newYear.venue, undefined);
  assert.equal(newYear.city, "Houston");
  assert.deepEqual(newYear.ticketTiers, []);
  assert.equal(newYear.status, "coming-soon");
  assert.equal(newYear.saleEnd, undefined);
  const serialized = JSON.stringify(newYear).toLowerCase();
  for (const leak of ["nichols", "morse", "77019", "google.com/maps", "address", "mapurl"]) {
    assert.equal(serialized.includes(leak), false, `New Year data mentions ${leak}`);
  }
});

test("the door keeps scanning Diwali: it stays the featured event", () => {
  assert.equal(diwali.featured, true);
  assert.equal(newYear.featured, false);
  assert.equal(events.filter((event) => event.featured).length, 1);
});

test("case 1 — Nov 7 11:00 PM: Diwali leads and shows sold out, New Year is upcoming", () => {
  assert.equal(salesPhase(diwali, NOV7_11PM), "closed");
  assert.equal(primaryEventAt(events, NOV7_11PM)?.id, diwali.id);
  assert.deepEqual(eventSeries(events).map((event) => event.id), [diwali.id, newYear.id]);
  assert.equal(salesWindowClosed(diwali.id, NOV7_11PM.getTime()), true);
});

test("case 2 — Nov 8 12:15 AM: Diwali still leads and shows sold out, New Year is upcoming", () => {
  const at = new Date("2026-11-08T00:15:00-06:00");
  assert.equal(salesPhase(diwali, at), "closed");
  assert.equal(primaryEventAt(events, at)?.id, diwali.id);
  assert.equal(salesWindowClosed(diwali.id, at.getTime()), true);
  assert.equal(salesPhase(diwali, NOV8_115AM), "closed");
});

test("case 3 — Nov 8 2:01 AM: New Year leads, Diwali is past and stays closed", () => {
  assert.equal(salesPhase(diwali, NOV8_201AM), "ended");
  assert.equal(primaryEventAt(events, NOV8_201AM)?.id, newYear.id);
  assert.equal(salesWindowClosed(diwali.id, NOV8_201AM.getTime()), true);
  assert.deepEqual(eventSeries(events).map((event) => event.id), [diwali.id, newYear.id], "Diwali stays in the series as a past chapter");
});

test("the boundaries are exact to the millisecond", () => {
  const close = Date.parse("2026-11-08T04:00:00.000Z");
  const end = Date.parse("2026-11-08T08:00:00.000Z");
  assert.equal(salesPhase(diwali, new Date(close - 1)), "open");
  assert.equal(salesPhase(diwali, new Date(close)), "closed");
  assert.equal(salesWindowClosed(diwali.id, close - 1), false);
  assert.equal(salesWindowClosed(diwali.id, close), true);
  assert.equal(primaryEventAt(events, new Date(end - 1))?.id, diwali.id);
  assert.equal(primaryEventAt(events, new Date(end))?.id, newYear.id);
});

test("the checkout function's cutoff is the same instant as the site's", () => {
  assert.equal(SALES_CLOSE_AT[diwali.id], salesCloseAt(diwali)?.toISOString());
  for (const event of events) {
    if (!event.saleEnd) continue;
    assert.equal(SALES_CLOSE_AT[event.id], salesCloseAt(event)?.toISOString(), `${event.id} cutoff differs between site and server`);
  }
  assert.equal(SALES_CLOSED_MESSAGE, "Sold out.");
});

test("an event without a cutoff is never closed by the sales window", () => {
  assert.equal(salesWindowClosed(newYear.id, NOV8_201AM.getTime()), false);
  assert.equal(salesWindowClosed("evt_unknown", Date.parse("2030-01-01T00:00:00Z")), false);
});

test("the lifecycle instant only moves at a boundary", () => {
  const boundaries = lifecycleBoundaries(events);
  assert.deepEqual(
    boundaries.map((at) => new Date(at).toISOString()),
    ["2026-11-08T04:00:00.000Z", "2026-11-08T08:00:00.000Z", "2027-01-02T08:00:00.000Z"],
  );
  assert.equal(lastBoundary(boundaries, NOV7_11PM.getTime()), boundaries[0]);
  assert.equal(lastBoundary(boundaries, NOV8_115AM.getTime()), boundaries[0]);
  assert.equal(lastBoundary(boundaries, NOV8_201AM.getTime()), boundaries[1]);
  // Deciding at the boundary instant gives the same answer as deciding at the real time.
  for (const moment of [NOV7_11PM, NOV8_115AM, NOV8_201AM]) {
    const at = new Date(lastBoundary(boundaries, moment.getTime()));
    assert.equal(salesPhase(diwali, at), salesPhase(diwali, moment));
    assert.equal(primaryEventAt(events, at)?.id, primaryEventAt(events, moment)?.id);
  }
});

test("both checkout paths refuse a closed sale before any hold, rate limit or PaymentIntent", () => {
  const checkout = source("../supabase/functions/checkout/index.ts");
  const single = checkout.slice(checkout.indexOf("async function handle("), checkout.indexOf("async function findPromotion("));
  const cart = checkout.slice(checkout.indexOf("async function handleCart("), checkout.indexOf("async function findCartPromotion("));
  for (const [name, body, reserve] of [
    ["single", single, "reserve_passes"],
    ["cart", cart, "reserve_cart"],
  ]) {
    const gate = body.indexOf("salesWindowClosed(eventId)");
    assert.ok(gate > 0, `${name} path has no sales window check`);
    for (const later of ["rateLimit(", "admin.rpc(", reserve, "stripe.paymentIntents.create", "stripe.prices.list"]) {
      const at = body.indexOf(later);
      assert.ok(at === -1 || at > gate, `${name} path calls ${later} before the sales window check`);
    }
  }
  // Releasing an unpaid hold is still allowed after the cutoff.
  assert.ok(checkout.indexOf("if (body.release === true) return release(req, body);") < checkout.indexOf("if (body.items !== undefined)"));
});

test("fulfilment, the door and admin never read the sales window", () => {
  for (const path of [
    "../supabase/functions/stripe-webhook/index.ts",
    "../supabase/functions/door/index.ts",
    "../supabase/functions/admin/index.ts",
    "../supabase/functions/ticket-view/index.ts",
    "../supabase/functions/vip-pass/index.ts",
  ]) {
    assert.doesNotMatch(source(path), /sales-window|salesWindowClosed/, path);
  }
});

test("the test clock exists only in development builds", () => {
  const clock = source("../src/lib/site-clock.ts");
  const guard = clock.indexOf('if (process.env.NODE_ENV !== "development") return null;');
  assert.ok(guard > 0, "simulated clock is not guarded by NODE_ENV");
  assert.ok(guard < clock.indexOf('get("lifecycle-now")'), "the query parameter is read before the guard");
});
