// Creates the PaymentIntent for the on-site checkout (/checkout).
// POST { eventId, tierId, quantity, name, email }  →  { clientSecret, paymentIntentId }
//
// Price, guest count and capacity come from the `tiers` table — nothing the
// browser sends can change what is charged or how many passes are issued.

import Stripe from "npm:stripe@17";
import { admin, corsHeaders, json } from "../_shared/http.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });

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

  const meta = tier.metadata as Record<string, string>;
  const intent = await stripe.paymentIntents.create({
    amount: tier.price_cents * quantity,
    currency: tier.currency,
    payment_method_types: ["card"],
    receipt_email: email,
    description: `${meta.omc_event_name ?? eventId} · ${tier.name} × ${quantity}`,
    statement_descriptor_suffix: "ONE MORE",
    metadata: {
      ...meta,
      omc_event_id: eventId,
      omc_tier_id: tierId,
      omc_tier_name: tier.name,
      omc_admits: String(tier.admits),
      omc_capacity: tier.capacity ? String(tier.capacity) : "",
      omc_quantity: String(quantity),
      omc_name: name,
      omc_email: email,
    },
  });

  return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
}

async function sold(eventId: string, tierId: string): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("quantity")
    .eq("event_id", eventId)
    .eq("tier_id", tierId)
    .neq("status", "refunded");
  if (error) throw error;
  return data.reduce((s, o) => s + o.quantity, 0);
}
