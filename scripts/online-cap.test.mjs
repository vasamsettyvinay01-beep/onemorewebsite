import assert from "node:assert/strict";
import test from "node:test";
import { applyAvailability } from "../src/lib/availability-rules.ts";

const event = {
  id: "evt_diwali_night",
  status: "on-sale",
  ticketTiers: [
    { id: "female", name: "Female" },
    { id: "general", name: "Male" },
    { id: "couple", name: "Couple", admits: 2 },
    { id: "group", name: "Group of 5", admits: 5 },
    { id: "group-8", name: "Group of 8", admits: 8, capacity: 3 },
    { id: "early-bird", name: "Early Bird", capacity: 10 },
  ],
};

test("below 360 online admissions, uncapped tiers stay on sale", () => {
  const next = applyAvailability(event, { "early-bird": 10 }, {}, { cap: 360, committed: 359 });
  assert.equal(next.status, "on-sale");
  assert.equal(next.ticketTiers.find((t) => t.id === "general").soldOut, undefined);
  assert.equal(next.ticketTiers.find((t) => t.id === "early-bird").soldOut, true);
});

test("at 360 online admissions every public pass shows sold out", () => {
  const next = applyAvailability(event, {}, {}, { cap: 360, committed: 360 });
  assert.equal(next.status, "sold-out");
  for (const tier of next.ticketTiers) {
    assert.equal(tier.soldOut, true, tier.id);
    assert.equal(tier.unavailable, true, tier.id);
  }
});

test("a full online room wins over a tier that still has packages left", () => {
  const next = applyAvailability(event, { "group-8": 0 }, { "group-8": 0 }, { cap: 360, committed: 400 });
  assert.equal(next.ticketTiers.find((t) => t.id === "group-8").soldOut, true);
});

test("no online cap leaves the event on sale", () => {
  const next = applyAvailability(event, {}, {});
  assert.equal(next.status, "on-sale");
  assert.ok(next.ticketTiers.filter((t) => t.capacity === undefined).every((t) => !t.soldOut));
});
