import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { events } from "../src/data/events.ts";
import { eventEndsAt, hasEventEnded } from "../src/lib/event-end.ts";

const diwali = events.find((event) => event.slug === "diwali-night");
if (!diwali) throw new Error("Diwali Night is missing");

test("Diwali Night ends at 2:00 AM Chicago on the morning after", () => {
  assert.equal(eventEndsAt(diwali)?.toISOString(), "2026-11-08T08:00:00.000Z");
});

test("passes stay on sale through the night and close when it ends", () => {
  assert.equal(hasEventEnded(diwali, new Date("2026-11-08T03:00:00.000Z")), false);
  assert.equal(hasEventEnded(diwali, new Date("2026-11-08T07:59:00.000Z")), false);
  assert.equal(hasEventEnded(diwali, new Date("2026-11-08T08:00:00.000Z")), true);
  assert.equal(hasEventEnded(diwali, new Date("2026-11-08T15:00:00.000Z")), true);
});

test("an end time on the same evening does not roll into the next day", () => {
  const ends = eventEndsAt({
    date: "2026-06-01",
    startTime: "18:00",
    endTime: "23:00",
    timezone: "America/Chicago",
  });
  assert.equal(ends?.toISOString(), "2026-06-02T04:00:00.000Z");
});

test("an event without a date never closes itself", () => {
  assert.equal(eventEndsAt({}), undefined);
  assert.equal(hasEventEnded({}), false);
});

test("checkout refuses a new payment after the stored end time", () => {
  const source = readFileSync(new URL("../supabase/functions/checkout/index.ts", import.meta.url), "utf8");
  assert.match(source, /omc_event_ends_at/);
  assert.match(source, /This night has ended/);
});
