// Runs the real `checkout` Edge Function handler with a simulated server clock
// and every outbound request (Supabase, Stripe) recorded instead of sent.
//
//   npx -y deno@2 run -A --no-lock scripts/checkout-cutoff.deno.ts
//
// After the Diwali cutoff, every direct purchase or quote request must be refused
// with `sales_closed` before the function touches the database or Stripe.

Deno.env.set("STRIPE_SECRET_KEY", "sk_test_cutoff_harness");
Deno.env.set("SUPABASE_URL", "http://supabase.invalid");
Deno.env.set("SERVICE_KEY", "service-role-harness");
Deno.env.set("SITE_URL", "https://theonemorecompany.com");

const outbound: string[] = [];
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  outbound.push(`${init?.method ?? (input instanceof Request ? input.method : "GET")} ${url}`);
  // Enough for a pre-cutoff request to show it got past the gate: no event_ops row,
  // rate limit allowed, and no such tier, so it stops with a 404 before reserving.
  const body = url.includes("/rpc/allow_request") ? "true" : url.includes("/rest/v1/") ? "[]" : "{}";
  return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
}) as typeof fetch;

let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: unknown }).serve = (fn: (req: Request) => Promise<Response>) => {
  handler = fn;
  return {} as Deno.HttpServer;
};

const realNow = Date.now;
let simulated = realNow();
Date.now = () => simulated;

await import("../supabase/functions/checkout/index.ts");
if (!handler) throw new Error("checkout did not register a handler");

const EVENT = "evt_diwali_night";
const key = () => crypto.randomUUID();
const buyer = { name: "Cutoff Harness", email: "harness@example.com" };

const purchases: [string, Record<string, unknown>][] = [
  ["Female", { eventId: EVENT, tierId: "female", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["Male", { eventId: EVENT, tierId: "general", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["Couple", { eventId: EVENT, tierId: "couple", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["Group of 5", { eventId: EVENT, tierId: "group", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["Group of 8", { eventId: EVENT, tierId: "group-8", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["Early Bird", { eventId: EVENT, tierId: "early-bird", quantity: 1, ...buyer, idempotencyKey: key() }],
  ["GISO15 Female", { eventId: EVENT, tierId: "female", quantity: 2, promoCode: "GISO15", ...buyer, idempotencyKey: key() }],
  ["Female quote", { quote: true, eventId: EVENT, tierId: "female", quantity: 1 }],
  ["GISO15 quote", { quote: true, eventId: EVENT, tierId: "general", quantity: 1, promoCode: "GISO15" }],
  [
    "mixed cart",
    {
      eventId: EVENT,
      items: [
        { ticket_type: "female", quantity: 1 },
        { ticket_type: "general", quantity: 1 },
        { ticket_type: "couple", quantity: 1 },
        { ticket_type: "group", quantity: 1 },
      ],
      ...buyer,
      idempotencyKey: key(),
    },
  ],
  [
    "mixed cart with Group of 8",
    { eventId: EVENT, items: [{ ticket_type: "group-8", quantity: 1 }, { ticket_type: "female", quantity: 2 }], ...buyer, idempotencyKey: key() },
  ],
  [
    "GISO15 mixed cart",
    {
      eventId: EVENT,
      items: [{ ticket_type: "female", quantity: 1 }, { ticket_type: "general", quantity: 1 }, { ticket_type: "couple", quantity: 1 }],
      promoCode: "GISO15",
      ...buyer,
      idempotencyKey: key(),
    },
  ],
  ["mixed cart quote", { quote: true, eventId: EVENT, items: [{ ticket_type: "female", quantity: 1 }, { ticket_type: "general", quantity: 1 }] }],
];

function request(body: Record<string, unknown>): Request {
  return new Request("https://curprrfrkefegefqiign.supabase.co/functions/v1/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://theonemorecompany.com", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function run(at: string, expectClosed: boolean) {
  simulated = Date.parse(at);
  console.log(`\nServer clock ${at}`);
  for (const [label, body] of purchases) {
    outbound.length = 0;
    const res = await handler!(request(body));
    const json = await res.json();
    if (expectClosed) {
      const touched = outbound.length > 0 ? `touched: ${outbound.join(", ")}` : "";
      check(res.status === 409 && json.code === "sales_closed" && outbound.length === 0, label, `${res.status} ${json.error ?? ""} ${touched}`);
    } else {
      check(json.code !== "sales_closed" && outbound.length > 0, label, `${res.status} reached ${outbound.length} backend call(s)`);
    }
  }
  outbound.length = 0;
  const released = await handler!(request({ release: true, idempotencyKey: key() }));
  const releasedBody = await released.json();
  check(releasedBody.code !== "sales_closed", "release of an unpaid hold still allowed", `${released.status}`);
}

await run("2026-11-07T23:00:00-06:00", false);
await run("2026-11-07T23:59:59.999-06:00", false);
await run("2026-11-08T00:00:00.000-06:00", true);
await run("2026-11-08T00:15:00-06:00", true);
await run("2026-11-08T02:01:00-06:00", true);

Date.now = realNow;
console.log(failures === 0 ? "\nAll cutoff checks passed." : `\n${failures} cutoff check(s) failed.`);
Deno.exit(failures === 0 ? 0 : 1);
