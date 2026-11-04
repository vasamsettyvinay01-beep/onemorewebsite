import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const arrival = readFileSync(new URL("../src/components/canvas/movements/Arrival.tsx", import.meta.url), "utf8");

test("the phone hero keeps the seal clear of the headline", () => {
  assert.match(arrival, /className="absolute inset-x-0 top-\[34%\] flex/);
  assert.match(arrival, /className="w-\[50vw\] max-w-\[13rem\] /);
});

test("short-screen hero rules apply to phones only, so short desktop windows keep the desktop layout", () => {
  assert.doesNotMatch(arrival, /(^|[\s"])short:/);
  assert.match(arrival, /max-sm:short:top-\[27%\]/);
  assert.match(arrival, /max-sm:short:w-\[38vw\]/);
  assert.match(arrival, /max-sm:short:bottom-\[15\.25rem\]/);
});
