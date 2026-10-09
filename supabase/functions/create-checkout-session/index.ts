// Embedded Checkout form for the on-site checkout (/checkout).
// POST { eventId, tierId, quantity, name, email, origin }  →  { client_secret }
//
// Price, guest count and capacity come from the `tiers` table — nothing the
// browser sends can change what is charged or how many passes are issued.
// Session metadata is what stripe-webhook reads to email the passes.

import Stripe from "npm:stripe@23";
import { admin, corsHeaders, json, SITE_URL } from "../_shared/http.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" as Stripe.LatestApiVersion,
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error(err);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Bad request" }, 400);
  }
  const eventId = String(body.eventId ?? "");
  const tierId = String(body.tierId ?? "");
  const quantity = Number(body.quantity);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!Number.isInteger(quantity) || quantity < 1) return json(req, { error: "Choose how many passes." }, 400);
  if (name.length < 2) return json(req, { error: "Enter the name for the booking." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: "Enter a valid email." }, 400);

  const { data: tier, error } = await admin
    .from("tiers")
    .select("*")
    .eq("event_id", eventId)
    .eq("tier_id", tierId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error(error);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  if (!tier) return json(req, { error: "This pass isn't available." }, 404);
  if (quantity > tier.max_per_order) return json(req, { error: `Up to ${tier.max_per_order} per booking.` }, 400);

  if (tier.opens_after) {
    const { data: gate } = await admin
      .from("tiers")
      .select("active, capacity")
      .eq("event_id", eventId)
      .eq("tier_id", tier.opens_after)
      .maybeSingle();
    const gateOpen = !gate || !gate.active || (gate.capacity !== null && (await sold(eventId, tier.opens_after)) >= gate.capacity);
    if (!gateOpen) return json(req, { error: `${tier.name} isn't on sale yet.` }, 409);
  }

  if (tier.capacity) {
    const remaining = tier.capacity - (await sold(eventId, tierId));
    if (remaining <= 0) return json(req, { error: `${tier.name} is sold out.`, remaining: 0 }, 409);
    if (quantity > remaining) return json(req, { error: `Only ${remaining} ${tier.name} left.`, remaining }, 409);
  }

  const stored = stringMeta(tier.metadata as Record<string, unknown>);
  const booking = {
    ...stored,
    omc_event_id: eventId,
    omc_tier_id: tierId,
    omc_tier_name: tier.name,
    omc_admits: String(tier.admits),
    omc_capacity: tier.capacity ? String(tier.capacity) : "",
    omc_quantity: String(quantity),
    omc_name: name,
    omc_email: email,
  };

  const mode = "payment" as const;
  const prices = await stripe.prices.list({ lookup_keys: [`${eventId}:${tierId}`], active: true, limit: 1 });
  const price = prices.data[0];
  const session = await stripe.checkout.sessions.create({
    ui_mode: "form",
    mode,
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: "auto",
    integration_identifier: "custom_embedded_web_0001",
    customer_email: email,
    return_url: `${returnOrigin(body.origin)}/tickets/?session={CHECKOUT_SESSION_ID}`,
    line_items: [
      price
        ? { quantity, price: price.id }
        : {
            quantity,
            price_data: {
              currency: tier.currency,
              unit_amount: tier.price_cents,
              product_data: { name: `${stored.omc_event_name ?? eventId} · ${tier.name}` },
            },
          },
    ],
    metadata: booking,
    payment_intent_data: {
      receipt_email: email,
      description: `${stored.omc_event_name ?? eventId} · ${tier.name} × ${quantity}`,
      statement_descriptor_suffix: "ONE MORE",
      // Skips payment_intent.succeeded so the session webhook is the one that emails the pass.
      metadata: { ...booking, omc_source: "embedded" },
    },
  });

  return json(req, { client_secret: session.client_secret });
}

function returnOrigin(value: unknown): string {
  const origin = String(value ?? "").replace(/\/$/, "");
  const site = SITE_URL;
  const allowed =
    origin === site ||
    origin === site.replace("://", "://www.") ||
    /^http:\/\/localhost:\d+$/.test(origin);
  return allowed ? origin : site;
}

function stringMeta(meta: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === null || value === undefined) continue;
    out[key] = String(value).slice(0, 500);
  }
  return out;
}

async function sold(eventId: string, tierId: string): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("quantity")
    .eq("event_id", eventId)
    .eq("tier_id", tierId)
    .neq("status", "refunded");
  if (error) throw error;
  return data.reduce((sum, order) => sum + order.quantity, 0);
}
