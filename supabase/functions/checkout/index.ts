// Creates the PaymentIntent for the on-site checkout (/checkout).
// POST { eventId, tierId, quantity, name, email, idempotencyKey } → { clientSecret, paymentIntentId }
// POST { quote: true, eventId, tierId, quantity } → { subtotal, tax, total, currency }
// POST { release: true, idempotencyKey } → drops an unpaid hold
//
// Price, tax, guest count and capacity come from the database and Stripe Tax.
// Nothing the browser sends can change what is charged.

import Stripe from "npm:stripe@17";
import { admin, corsHeaders, json } from "../_shared/http.ts";
import { quoteTicketTotal } from "../_shared/pricing.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-z0-9_-]{1,64}$/i;

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error(JSON.stringify({ msg: "checkout_error", error: (err as Error).message?.slice(0, 300) }));
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

  if (body.release === true) return release(req, body);

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const tierId = typeof body.tierId === "string" ? body.tierId : "";
  const quantity = Number(body.quantity);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const quote = body.quote === true;
  if (!ID_RE.test(eventId) || !ID_RE.test(tierId)) return json(req, { error: "This pass isn't available." }, 404);
  const closed = await salesClosed(eventId);
  if (closed) return json(req, { error: closed }, 409);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return json(req, { error: "Choose how many passes." }, 400);
  if (!quote && name.length < 2) return json(req, { error: "Enter the name for the booking." }, 400);
  if (!quote && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: "Enter a valid email." }, 400);

  const ip = clientIp(req);
  const allowed = await rateLimit(quote ? `quote:${ip}` : `pay:${ip}`, quote ? 60 : 12, 600);
  if (!allowed) return json(req, { error: "Please wait a moment and try again." }, 429);

  const { data: tier, error } = await admin
    .from("tiers")
    .select("*")
    .eq("event_id", eventId)
    .eq("tier_id", tierId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ msg: "tier_read_failed", eventId, tierId }));
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
    const gateSold = gate?.capacity != null ? await countSold(eventId, tier.opens_after) : 0;
    const gateOpen = !gate || !gate.active || (gate.capacity !== null && gateSold >= gate.capacity);
    if (!gateOpen) return json(req, { error: `${tier.name} isn't on sale yet.` }, 409);
  }

  if (tier.capacity) {
    const remaining = tier.capacity - (await countCommitted(eventId, tierId));
    if (remaining <= 0) return json(req, { error: `${tier.name} is sold out.`, remaining: 0 }, 409);
    if (quantity > remaining) return json(req, { error: `Only ${remaining} ${tier.name} left.`, remaining }, 409);
  }

  const prices = await stripe.prices.list({ lookup_keys: [`${eventId}:${tierId}`], active: true, limit: 1 });
  const price = prices.data[0];
  if (price && (price.unit_amount !== tier.price_cents || price.currency !== tier.currency)) {
    console.error(JSON.stringify({ msg: "price_mismatch", eventId, tierId }));
    return json(req, { error: "This pass isn't available right now." }, 409);
  }

  const unit = tier.price_cents as number;
  const currency = tier.currency as string;
  let quoted: { tax: number; total: number; calculationId: string };
  try {
    quoted = await quoteTicketTotal(stripe, currency, unit, quantity, tierId);
  } catch (err) {
    console.error(JSON.stringify({ msg: "tax_quote_failed", eventId, tierId, error: (err as Error).message?.slice(0, 200) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  if (quote) return json(req, { subtotal: unit * quantity, tax: quoted.tax, total: quoted.total, currency });

  const idempotencyKey = typeof body.idempotencyKey === "string" && UUID_RE.test(body.idempotencyKey)
    ? body.idempotencyKey
    : crypto.randomUUID();

  const reserved = await admin.rpc("reserve_passes", {
    p_event_id: eventId,
    p_tier_id: tierId,
    p_quantity: quantity,
    p_idempotency_key: idempotencyKey,
  });
  if (reserved.error) return reserveError(req, reserved.error.message ?? "", tier.name);

  const hold = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
  if (hold?.already) {
    const reused = await reuseIntent(req, idempotencyKey, hold.payment_intent_id);
    if (reused) return reused;
  }

  const meta = stringMeta(tier.metadata as Record<string, unknown>);
  const productName = `${meta.omc_event_name ?? eventId} · ${tier.name}`;
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: quoted.total,
        currency,
        payment_method_types: ["card"],
        receipt_email: email,
        description: `${productName} × ${quantity}`,
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
          omc_price_id: price?.id ?? "",
          omc_expected_total: String(quoted.total),
        },
        hooks: { inputs: { tax: { calculation: quoted.calculationId } } },
        amount_details: {
          line_items: [
            {
              product_name: productName,
              product_code: tierId.replace(/[^a-z0-9]/gi, "").slice(0, 12),
              unit_cost: unit,
              quantity,
              tax: { total_tax_amount: quoted.tax },
            },
          ],
        },
      } as Stripe.PaymentIntentCreateParams,
      { idempotencyKey },
    );
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/idempoten/i.test(message)) {
      const reused = await reuseIntent(req, idempotencyKey, null);
      if (reused) return reused;
    } else if (!hold?.already) {
      await admin.from("checkout_holds").delete().eq("idempotency_key", idempotencyKey).is("payment_intent_id", null);
    }
    throw err;
  }

  const attached = await admin
    .from("checkout_holds")
    .update({ payment_intent_id: intent.id })
    .eq("idempotency_key", idempotencyKey)
    .is("payment_intent_id", null);
  if (attached.error) {
    console.error(JSON.stringify({ msg: "hold_attach_failed", paymentIntentId: intent.id }));
  }
  console.log(JSON.stringify({ msg: "payment_intent", paymentIntentId: intent.id, eventId, tierId, quantity, amount: intent.amount, currency }));
  return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
}

async function reuseIntent(req: Request, idempotencyKey: string, knownId: string | null): Promise<Response | null> {
  let paymentIntentId = knownId;
  for (let attempt = 0; !paymentIntentId && attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const row = await admin.from("checkout_holds").select("payment_intent_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    paymentIntentId = row.data?.payment_intent_id ?? null;
  }
  if (!paymentIntentId) return null;
  const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (!existing.client_secret || existing.status === "canceled") return null;
  return json(req, { clientSecret: existing.client_secret, paymentIntentId: existing.id });
}

async function release(req: Request, body: Record<string, unknown>): Promise<Response> {
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!UUID_RE.test(key)) return json(req, { error: "Bad request" }, 400);
  const { data: hold } = await admin.from("checkout_holds").select("payment_intent_id").eq("idempotency_key", key).maybeSingle();
  if (hold?.payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
    if (pi.status === "succeeded" || pi.status === "processing") return json(req, { released: false });
    if (pi.status !== "canceled") await stripe.paymentIntents.cancel(hold.payment_intent_id);
  }
  await admin.from("checkout_holds").delete().eq("idempotency_key", key);
  return json(req, { released: true });
}

function reserveError(req: Request, message: string, tierName: string): Response {
  if (message.includes("sold_out")) return json(req, { error: `${tierName} is sold out.`, remaining: 0 }, 409);
  if (message.includes("too_many")) return json(req, { error: "Choose fewer passes." }, 400);
  if (message.includes("unavailable")) return json(req, { error: "This pass isn't available." }, 404);
  if (message.includes("bad_quantity") || message.includes("bad_idempotency") || message.includes("idempotency_mismatch")) {
    return json(req, { error: "Choose how many passes." }, 400);
  }
  console.error(JSON.stringify({ msg: "reserve_failed", error: message.slice(0, 200) }));
  return json(req, { error: "Something went wrong. Please try again." }, 500);
}

async function countSold(eventId: string, tierId: string): Promise<number> {
  const { data, error } = await admin.rpc("tier_sold", { p_event_id: eventId, p_tier_id: tierId });
  if (error) throw error;
  return Number(data ?? 0);
}

async function salesClosed(eventId: string): Promise<string | null> {
  const { data, error } = await admin.from("event_ops").select("status").eq("event_id", eventId).maybeSingle();
  if (error) {
    if (/event_ops|schema cache|does not exist/i.test(error.message)) return null;
    throw error;
  }
  if (!data || data.status === "open") return null;
  return data.status === "cancelled" ? "This event has been cancelled." : "Ticket sales are paused.";
}

async function countCommitted(eventId: string, tierId: string): Promise<number> {
  const [sold, held] = await Promise.all([
    countSold(eventId, tierId),
    admin.rpc("tier_held", { p_event_id: eventId, p_tier_id: tierId }),
  ]);
  if (held.error) throw held.error;
  return sold + Number(held.data ?? 0);
}

async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("allow_request", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(JSON.stringify({ msg: "rate_limit_unavailable" }));
    return true;
  }
  return data === true;
}

function stringMeta(meta: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = String(value).slice(0, 500);
  }
  return out;
}

function clientIp(req: Request): string {
  const raw = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
  return raw.split(",")[0]?.trim().slice(0, 64) || "unknown";
}
