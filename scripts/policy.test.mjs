import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const emailLine =
  "All ticket sales are final. Refunds are available only if the event is cancelled by The One More Company, subject to applicable law.";

test("refund policy wording is the same in the page source and the email", () => {
  const policy = readFileSync(new URL("../src/data/refund-policy.ts", import.meta.url), "utf8");
  const email = readFileSync(new URL("../supabase/functions/_shared/pass-email.ts", import.meta.url), "utf8");
  const sender = readFileSync(new URL("../supabase/functions/_shared/email.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/refunds/page.tsx", import.meta.url), "utf8");
  assert.match(policy, /All ticket sales are final/);
  assert.ok(email.includes(emailLine));
  assert.match(email, />View passes</);
  assert.match(sender, /\/tickets\/\?o=\$\{t\.accessToken\}/);
  assert.doesNotMatch(email, /tickets\/shared/);
  assert.match(email, /https:\/\/theonemorecompany\.com\/refunds/);
  assert.match(page, /RefundPolicyBody/);
});

test("event cancellation matches a server-side name", () => {
  const admin = readFileSync(new URL("../supabase/functions/admin/index.ts", import.meta.url), "utf8");
  assert.match(admin, /EVENT_NAMES\[eventId\]/);
  assert.doesNotMatch(admin, /body\.eventName/);
  assert.match(admin, /order\.event_id !== String\(body\.eventId/);
});

test("a share token is not stored as itself", () => {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  assert.equal(token.length, 64);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
});
