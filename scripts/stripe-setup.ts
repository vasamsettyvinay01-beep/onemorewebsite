/**
 * Syncs an event's ticket tiers to the ticketing backend and Stripe.
 *
 *   node --env-file=.env.local scripts/stripe-setup.ts [event-slug]
 *
 * Needs in env: STRIPE_SECRET_KEY, SUPABASE_PROJECT_REF, SUPABASE_SECRET_KEY,
 * and WEBHOOK_URL (the stripe-webhook function URL).
 *
 *  1. Upserts every sellable tier into the `tiers` table — the server-side
 *     price list the `checkout` function charges from.
 *  2. Points the Stripe webhook at payment_intent.succeeded + charge.refunded
 *     (prints the signing secret when it creates the endpoint).
 *  3. Deactivates Payment Links from the earlier hosted-checkout setup.
 *
 * Safe to re-run after any change to tiers in src/data/events.ts.
 */
import { events } from "../src/data/events.ts";

const key = process.env.STRIPE_SECRET_KEY;
const ref = process.env.SUPABASE_PROJECT_REF;
const secret = process.env.SUPABASE_SECRET_KEY;
const webhookUrl = process.env.WEBHOOK_URL;
if (!key || !ref || !secret) {
  console.error("Set STRIPE_SECRET_KEY, SUPABASE_PROJECT_REF and SUPABASE_SECRET_KEY (and WEBHOOK_URL).");
  process.exit(1);
}

const slug = process.argv[2];
const event = slug ? events.find((e) => e.slug === slug) : events.find((e) => e.featured);
if (!event) {
  console.error(`No event ${slug ?? "(featured)"} in src/data/events.ts`);
  process.exit(1);
}

type Params = Record<string, unknown>;
/** The few fields this script reads off Stripe responses. */
type StripeObj = {
  id: string;
  url: string;
  secret: string;
  active: boolean;
  unit_amount: number;
  currency: string;
  metadata: Record<string, string>;
  data: StripeObj[];
  has_more: boolean;
};

function encode(params: Params, prefix = ""): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.flatMap((item, i) => (typeof item === "object" ? encode(item as Params, `${name}[${i}]`) : [`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`]));
    if (v !== null && typeof v === "object") return encode(v as Params, name);
    return [`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`];
  });
}

async function stripe(method: "GET" | "POST", path: string, params: Params = {}): Promise<StripeObj> {
  const qs = encode(params).join("&");
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? qs : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

async function listAll(path: string, params: Params = {}): Promise<StripeObj[]> {
  const out: StripeObj[] = [];
  let starting_after: string | undefined;
  for (;;) {
    const page = await stripe("GET", path, { ...params, limit: 100, starting_after });
    out.push(...page.data);
    if (!page.has_more) return out;
    starting_after = page.data.at(-1)?.id;
  }
}

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const dateLabel = event.date
  ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
      new Date(`${event.date}T12:00:00`),
    )
  : "";
const assets = `https://${ref}.supabase.co/storage/v1/object/public/brand/${event.slug}`;

/** Event details copied onto every PaymentIntent, then into the pass email. */
const eventMeta = {
  omc_event_name: event.name,
  omc_chapter: event.chapter !== undefined ? String(event.chapter).padStart(2, "0") : "",
  omc_event_date: dateLabel,
  omc_event_time: event.startTime ? `${clock(event.startTime)}${event.endTime ? ` – ${clock(event.endTime)}` : ""}` : "",
  omc_venue_name: event.venue?.name ?? event.city ?? "",
  omc_venue_address: event.venue?.address ?? event.city ?? "",
  omc_map_url: event.venue?.mapUrl ?? "",
  omc_hero_url: `${assets}/hero.jpg`,
  omc_min_age: event.minimumAge ? String(event.minimumAge) : "",
  omc_invitation: event.invitation ?? "",
  omc_partner: event.partner ?? "",
  omc_notice: event.notice ?? "",
  omc_partners: JSON.stringify(
    (event.partners ?? []).map((p) => ({
      name: p.name,
      logo: p.logo.replace(/^\/brand\//, ""),
      w: p.width,
      h: p.height,
      note: p.note ?? "",
    })),
  ),
};

const mode = key.includes("_live_") ? "LIVE" : "TEST";
console.log(`\n${mode} mode · ${event.name} (${event.id})\n`);

// 1. Tiers
const rows = event.ticketTiers.map((t) => ({
  event_id: event.id,
  tier_id: t.id,
  name: t.name,
  price_cents: Math.max(t.priceCents, 1),
  currency: t.currency.toLowerCase(),
  admits: t.admits ?? 1,
  capacity: t.capacity ?? null,
  max_per_order: t.maxPerOrder ?? 10,
  opens_after: t.opensAfter ?? null,
  active: !t.priceOnRequest && !t.hidden && !t.soldOut && t.priceCents > 0,
  metadata: eventMeta,
  updated_at: new Date().toISOString(),
}));
const res = await fetch(`https://${ref}.supabase.co/rest/v1/tiers?on_conflict=event_id,tier_id`, {
  method: "POST",
  headers: {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  },
  body: JSON.stringify(rows),
});
if (!res.ok) throw new Error(`Saving tiers: ${res.status} ${await res.text()}`);
for (const r of rows) {
  console.log(`  ${r.active ? "on " : "off"}  ${r.name.padEnd(20)} $${(r.price_cents / 100).toFixed(2)}  admits ${r.admits}${r.capacity ? `  cap ${r.capacity}` : ""}`);
}

// Catalog entries in the Stripe Dashboard. Hidden or price-on-request tiers stay out.
const catalog = (await listAll("products")).filter((p) => p.metadata?.omc_event_id === event.id);
for (const tier of event.ticketTiers) {
  if (tier.priceOnRequest || tier.hidden || tier.priceCents <= 0) continue;
  const fields = {
    name: `${event.name} · ${tier.name}`,
    description: `${event.name} pass. Admits ${tier.admits ?? 1}.`,
    metadata: { omc_event_id: event.id, omc_tier_id: tier.id, omc_admits: String(tier.admits ?? 1) },
  };
  const found = catalog.find((p) => p.metadata?.omc_tier_id === tier.id);
  const product = found ? await stripe("POST", `products/${found.id}`, fields) : await stripe("POST", "products", fields);
  const prices = await listAll("prices", { product: product.id, active: true });
  const current = prices.find((p) => p.unit_amount === tier.priceCents && p.currency === tier.currency.toLowerCase());
  if (current) {
    await stripe("POST", `prices/${current.id}`, { lookup_key: `${event.id}:${tier.id}`, transfer_lookup_key: true });
    continue;
  }
  const price = await stripe("POST", "prices", {
    product: product.id,
    unit_amount: tier.priceCents,
    currency: tier.currency.toLowerCase(),
    lookup_key: `${event.id}:${tier.id}`,
    transfer_lookup_key: true,
    metadata: { omc_tier_id: tier.id },
  });
  for (const old of prices) {
    if (old.id !== price.id) await stripe("POST", `prices/${old.id}`, { active: false });
  }
  console.log(`  catalog  ${tier.name}  ${price.id}`);
}

// 2. Webhook
if (webhookUrl) {
  const enabled_events = ["checkout.session.completed", "payment_intent.succeeded", "charge.refunded"];
  const existing = (await listAll("webhook_endpoints")).find((e) => e.url === webhookUrl);
  if (existing) {
    await stripe("POST", `webhook_endpoints/${existing.id}`, { enabled_events });
    console.log(`\nWebhook ${existing.id} listens for ${enabled_events.join(", ")}.`);
  } else {
    const created = await stripe("POST", "webhook_endpoints", { url: webhookUrl, enabled_events, description: "One More passes" });
    console.log(`\nWebhook created. Set this as the STRIPE_WEBHOOK_SECRET Supabase secret:\n  ${created.secret}`);
  }
}

// 3. Retire hosted Payment Links
for (const link of await listAll("payment_links", { active: true })) {
  if (link.metadata?.omc_event_id !== event.id) continue;
  await stripe("POST", `payment_links/${link.id}`, { active: false });
  console.log(`  retired payment link ${link.url}`);
}
