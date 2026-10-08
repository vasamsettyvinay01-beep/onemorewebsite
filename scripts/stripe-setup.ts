/**
 * Creates (or reuses) the Stripe products, prices and Payment Links for an
 * event's ticket tiers, plus the webhook that issues tickets.
 *
 *   $env:STRIPE_SECRET_KEY="sk_test_..."
 *   $env:SITE_URL="https://example.com"
 *   $env:WEBHOOK_URL="https://<project>.supabase.co/functions/v1/stripe-webhook"
 *   node scripts/stripe-setup.ts [event-slug]
 *
 * Safe to re-run. A price change creates a new price + link; the old link is
 * deactivated. Prints the links to paste into src/data/events.ts.
 */
import { events } from "../src/data/events.ts";

const key = process.env.STRIPE_SECRET_KEY;
const siteUrl = process.env.SITE_URL?.replace(/\/$/, "");
const webhookUrl = process.env.WEBHOOK_URL;
if (!key || !siteUrl) {
  console.error("Set STRIPE_SECRET_KEY and SITE_URL (and WEBHOOK_URL to create the webhook).");
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
type StripeObj = { id: string; url: string; secret: string; metadata: Record<string, string>; data: StripeObj[]; has_more: boolean };

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

const when = event.date
  ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
      new Date(`${event.date}T12:00:00`),
    ) + (event.startTime ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}` : "")
  : "";
const where = [event.venue?.name, event.venue?.address ?? event.city].filter(Boolean).join(", ");

const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
console.log(`\n${mode} mode · ${event.name} (${event.id})\n`);

const existingLinks = await listAll("payment_links", { active: true });
const results: { tier: string; url: string }[] = [];

for (const tier of event.ticketTiers) {
  if (tier.priceOnRequest || tier.priceCents <= 0) continue;

  const lookupKey = `omc__${event.id}__${tier.id}__${tier.priceCents}`;
  const metadata = {
    omc_event_id: event.id,
    omc_tier_id: tier.id,
    omc_tier_name: tier.name,
    omc_admits: String(tier.admits ?? 1),
    omc_capacity: tier.capacity ? String(tier.capacity) : "",
    omc_event_name: event.name,
    omc_event_when: when,
    omc_event_where: where,
    omc_min_age: event.minimumAge ? String(event.minimumAge) : "",
  };

  let price = (await stripe("GET", "prices", { lookup_keys: [lookupKey], expand: ["data.product"] })).data[0];
  if (!price) {
    const product = await stripe("POST", "products", {
      name: `${event.name} — ${tier.name}`,
      description: (tier.admits ?? 1) > 1 ? `Admits ${tier.admits}. One QR code per guest.` : "Admits 1.",
      metadata,
    });
    price = await stripe("POST", "prices", {
      product: product.id,
      unit_amount: tier.priceCents,
      currency: tier.currency.toLowerCase(),
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      metadata,
    });
  } else {
    await stripe("POST", `prices/${price.id}`, { metadata });
  }

  const linkParams = {
    after_completion: { type: "redirect", redirect: { url: `${siteUrl}/tickets/?session={CHECKOUT_SESSION_ID}` } },
    metadata: { omc_lookup_key: lookupKey, omc_event_id: event.id, omc_tier_id: tier.id },
  };

  const sameTier = existingLinks.filter((l) => l.metadata?.omc_event_id === event.id && l.metadata?.omc_tier_id === tier.id);
  let link = sameTier.find((l) => l.metadata?.omc_lookup_key === lookupKey);
  for (const stale of sameTier.filter((l) => l !== link)) {
    await stripe("POST", `payment_links/${stale.id}`, { active: false });
    console.log(`  deactivated old ${tier.name} link ${stale.url}`);
  }

  if (link) {
    link = await stripe("POST", `payment_links/${link.id}`, linkParams);
  } else {
    link = await stripe("POST", "payment_links", {
      ...linkParams,
      line_items: [
        {
          price: price.id,
          quantity: 1,
          adjustable_quantity: { enabled: true, minimum: 1, maximum: tier.maxPerOrder ?? 10 },
        },
      ],
      phone_number_collection: { enabled: false },
    });
  }
  results.push({ tier: tier.id, url: link.url });
  console.log(`  ${tier.name.padEnd(20)} ${link.url}`);
}

if (webhookUrl) {
  const enabled_events = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"];
  const endpoints = await listAll("webhook_endpoints");
  const existing = endpoints.find((e) => e.url === webhookUrl);
  if (existing) {
    await stripe("POST", `webhook_endpoints/${existing.id}`, { enabled_events });
    console.log(`\nWebhook already exists (${existing.id}). Its signing secret is in the Stripe dashboard.`);
  } else {
    const created = await stripe("POST", "webhook_endpoints", {
      url: webhookUrl,
      enabled_events,
      description: "One More tickets",
    });
    console.log(`\nWebhook created. Set this as the STRIPE_WEBHOOK_SECRET Supabase secret:\n  ${created.secret}`);
  }
}

console.log("\nPaste into src/data/events.ts:");
for (const r of results) console.log(`  ${r.tier}: paymentLink: "${r.url}",`);
