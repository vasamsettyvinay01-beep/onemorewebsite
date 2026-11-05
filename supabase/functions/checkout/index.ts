// Creates the PaymentIntent for the on-site checkout (/checkout).
// POST { eventId, tierId, quantity, name, email, idempotencyKey, promoCode? } → { clientSecret, paymentIntentId }
// POST { quote: true, eventId, tierId, quantity, promoCode? }
//   → { subtotal, discount, discountedSubtotal, tax, total, currency, promo }
// POST { release: true, idempotencyKey } → drops an unpaid hold
//
// Mixed-ticket cart (several ticket types, one payment):
// POST { eventId, items: [{ ticket_type, quantity }], name, email, idempotencyKey, promoCode? }
//   → { clientSecret, paymentIntentId }
// POST { quote: true, eventId, items, promoCode? }
//   → { subtotal, discount, discountedSubtotal, tax, total, currency, promo, lines, totalAdmissions }
//
// Price, discount, tax, guest count and capacity come from the database and
// Stripe Tax. The browser sends only the code it typed. Nothing it sends can
// change what is charged.

import Stripe from "npm:stripe@17";
import { admin, corsHeaders, json } from "../_shared/http.ts";
import { quoteCartTotal, quoteTicketTotal } from "../_shared/pricing.ts";
import {
  buildCartSnapshot,
  CART_ERRORS,
  cartMetaSummary,
  cartSummaryLabel,
  MAX_CART_ADMISSIONS,
  parseCartItems,
  priceCart,
  promoHasNoEligibleLine,
} from "../_shared/cart.mjs";
import {
  eligibleTierIds,
  normalizePromoCode,
  priceTickets,
  PROMO_INVALID,
  PROMO_NOT_ELIGIBLE,
  promoEligibilityMessage,
  promoTierSnapshot,
  promotionAppliesToTier,
  promotionIsLive,
} from "../_shared/promo.mjs";

interface LivePromotion {
  id: string;
  code: string;
  percent: number;
  eligibleTierIds: string[];
}

interface PromoRejection {
  error: string;
  code: "promo_invalid" | "PROMO_NOT_ELIGIBLE";
}

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
  // Mixed-ticket carts. A request without `items` is the single-ticket request
  // and runs the code below exactly as it always has.
  if (body.items !== undefined) return handleCart(req, body);

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const tierId = typeof body.tierId === "string" ? body.tierId : "";
  const quantity = Number(body.quantity);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const quote = body.quote === true;
  const promoCode = normalizePromoCode(body.promoCode);
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
  if (nightHasEnded(tier.metadata)) return json(req, { error: "This night has ended." }, 409);
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

  let promo: LivePromotion | null = null;
  if (promoCode !== "") {
    if (!(await rateLimit(`promo:${ip}`, 20, 600))) return json(req, { error: "Please wait a moment and try again." }, 429);
    if (promoCode === null) return json(req, { error: PROMO_INVALID, code: "promo_invalid" }, 422);
    const resolved = await findPromotion(eventId, promoCode, tierId);
    if ("error" in resolved) return json(req, resolved, 422);
    promo = resolved;
  }

  const unit = tier.price_cents as number;
  const currency = tier.currency as string;
  const priced = priceTickets({ unitCents: unit, quantity, percent: promo?.percent ?? 0 });
  let quoted: { tax: number; total: number; calculationId: string };
  try {
    quoted = await quoteTicketTotal(stripe, currency, priced.discountedSubtotal, tierId);
  } catch (err) {
    console.error(JSON.stringify({ msg: "tax_quote_failed", eventId, tierId, error: (err as Error).message?.slice(0, 200) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  if (quote) {
    return json(req, {
      subtotal: priced.originalSubtotal,
      discount: priced.discount,
      discountedSubtotal: priced.discountedSubtotal,
      tax: quoted.tax,
      total: quoted.total,
      currency,
      promo: promo ? { code: promo.code, percent: promo.percent } : null,
    });
  }

  const promoTiers = promo ? promoTierSnapshot(promo.eligibleTierIds) : "";
  if (promo && !promoTiers) return json(req, { error: "Something went wrong. Please try again." }, 500);

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
  const expected = { amount: quoted.total, promoCode: promo?.code ?? "" };
  if (hold?.already) {
    const reused = await reuseIntent(req, idempotencyKey, hold.payment_intent_id, expected);
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
        description: `${productName} × ${quantity}${promo ? ` · ${promo.code} ${promo.percent}% off` : ""}`,
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
          omc_promo_code: promo?.code ?? "",
          omc_promotion_id: promo?.id ?? "",
          omc_discount_percent: promo ? String(promo.percent) : "",
          omc_promo_eligible_tiers: promoTiers,
          omc_original_subtotal: String(priced.originalSubtotal),
          omc_discount_amount: String(priced.discount),
          omc_discounted_subtotal: String(priced.discountedSubtotal),
          omc_tax: String(quoted.tax),
        },
        hooks: { inputs: { tax: { calculation: quoted.calculationId } } },
        amount_details: {
          line_items: [
            {
              product_name: productName,
              product_code: tierId.replace(/[^a-z0-9]/gi, "").slice(0, 12),
              unit_cost: unit,
              quantity,
              ...(priced.discount > 0 ? { discount_amount: priced.discount } : {}),
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
      const reused = await reuseIntent(req, idempotencyKey, null, expected);
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
  console.log(JSON.stringify({
    msg: "payment_intent",
    paymentIntentId: intent.id,
    eventId,
    tierId,
    quantity,
    amount: intent.amount,
    currency,
    promoCode: promo?.code ?? null,
    discount: priced.discount,
  }));
  return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
}

async function findPromotion(eventId: string, code: string, tierId: string): Promise<LivePromotion | PromoRejection> {
  const { data, error } = await admin
    .from("promotions")
    .select("id, code, event_id, discount_type, discount_value, active, starts_at, expires_at, eligible_tier_ids")
    .eq("event_id", eventId)
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data || !promotionIsLive(data, eventId)) return { error: PROMO_INVALID, code: "promo_invalid" };
  const tiers = eligibleTierIds(data);
  if (!promotionAppliesToTier(data, tierId)) {
    return { error: await eligibilityCopy(eventId, data.code, tiers), code: PROMO_NOT_ELIGIBLE };
  }
  return { id: data.id, code: data.code, percent: data.discount_value, eligibleTierIds: tiers };
}

async function eligibilityCopy(eventId: string, code: string, tierIds: string[]): Promise<string> {
  if (tierIds.length === 0) return promoEligibilityMessage(code, []);
  const { data, error } = await admin.from("tiers").select("tier_id, name").eq("event_id", eventId).in("tier_id", tierIds);
  if (error) throw error;
  const namesById = new Map((data ?? []).map((row: { tier_id: string; name: string }) => [row.tier_id, row.name]));
  const names = tierIds.map((id) => namesById.get(id)).filter((name): name is string => typeof name === "string" && name.length > 0);
  return promoEligibilityMessage(code, names);
}

async function reuseIntent(
  req: Request,
  idempotencyKey: string,
  knownId: string | null,
  expected: { amount: number; promoCode: string },
): Promise<Response | null> {
  let paymentIntentId = knownId;
  for (let attempt = 0; !paymentIntentId && attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const row = await admin.from("checkout_holds").select("payment_intent_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    paymentIntentId = row.data?.payment_intent_id ?? null;
  }
  if (!paymentIntentId) return null;
  const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (!existing.client_secret || existing.status === "canceled") return null;
  if (existing.amount !== expected.amount || (existing.metadata?.omc_promo_code ?? "") !== expected.promoCode) {
    return json(req, { error: "Your booking changed. Please try again." }, 409);
  }
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

function nightHasEnded(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const ends = (metadata as Record<string, unknown>).omc_event_ends_at;
  if (typeof ends !== "string" || !ends) return false;
  const at = Date.parse(ends);
  return Number.isFinite(at) && Date.now() >= at;
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

// ── Mixed-ticket cart ────────────────────────────────────────────────────────
// The browser names ticket types and quantities. Prices, admissions per ticket,
// availability, promo eligibility, discount, tax and the total are all decided
// here, from the tiers table, the promotions table and Stripe Tax.

interface CartTier {
  event_id: string;
  tier_id: string;
  name: string;
  price_cents: number;
  currency: string;
  admits: number;
  capacity: number | null;
  max_per_order: number;
  opens_after: string | null;
  metadata: Record<string, unknown> | null;
}

async function handleCart(req: Request, body: Record<string, unknown>): Promise<Response> {
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const quote = body.quote === true;
  const promoCode = normalizePromoCode(body.promoCode);
  if (!ID_RE.test(eventId)) return json(req, { error: "This pass isn't available." }, 404);

  const parsed = parseCartItems(body.items);
  if ("error" in parsed) {
    const code = parsed.error as keyof typeof CART_ERRORS;
    return json(req, { error: CART_ERRORS[code], code }, code === "not_public" ? 404 : 400);
  }
  const items = parsed.items as { tierId: string; quantity: number }[];

  const closed = await salesClosed(eventId);
  if (closed) return json(req, { error: closed }, 409);
  if (!quote && name.length < 2) return json(req, { error: "Enter the name for the booking." }, 400);
  if (!quote && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: "Enter a valid email." }, 400);

  const ip = clientIp(req);
  const allowed = await rateLimit(quote ? `quote:${ip}` : `pay:${ip}`, quote ? 60 : 12, 600);
  if (!allowed) return json(req, { error: "Please wait a moment and try again." }, 429);

  // Only active tiers of this event are ever read. A private or inactive tier
  // is simply absent here, so naming one cannot add it to a cart.
  const { data: tierRows, error: tierError } = await admin
    .from("tiers")
    .select("event_id, tier_id, name, price_cents, currency, admits, capacity, max_per_order, opens_after, metadata")
    .eq("event_id", eventId)
    .in("tier_id", items.map((item) => item.tierId))
    .eq("active", true);
  if (tierError) {
    console.error(JSON.stringify({ msg: "cart_tier_read_failed", eventId }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  const tiers = new Map<string, CartTier>((tierRows ?? []).map((row: CartTier): [string, CartTier] => [row.tier_id, row]));
  const ordered: CartTier[] = [];
  for (const item of items) {
    const tier = tiers.get(item.tierId);
    if (!tier) return json(req, { error: "This pass isn't available." }, 404);
    ordered.push(tier);
  }
  const currency = ordered[0].currency;
  if (ordered.some((tier) => tier.currency !== currency)) {
    console.error(JSON.stringify({ msg: "cart_currency_mismatch", eventId }));
    return json(req, { error: "This pass isn't available right now." }, 409);
  }

  let admissions = 0;
  for (let i = 0; i < items.length; i += 1) {
    const tier = ordered[i];
    const quantity = items[i].quantity;
    if (nightHasEnded(tier.metadata)) return json(req, { error: "This night has ended." }, 409);
    if (quantity > tier.max_per_order) return json(req, { error: `Up to ${tier.max_per_order} ${tier.name} per booking.` }, 400);
    admissions += quantity * Math.max(tier.admits, 1);
  }
  if (admissions > MAX_CART_ADMISSIONS) return json(req, { error: CART_ERRORS.too_many_admissions, code: "too_many_admissions" }, 400);

  for (let i = 0; i < items.length; i += 1) {
    const tier = ordered[i];
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
      const remaining = tier.capacity - (await countCommitted(eventId, tier.tier_id));
      if (remaining <= 0) return json(req, { error: `${tier.name} is sold out.`, remaining: 0, ticket_type: tier.tier_id }, 409);
      if (items[i].quantity > remaining) {
        return json(req, { error: `Only ${remaining} ${tier.name} left.`, remaining, ticket_type: tier.tier_id }, 409);
      }
    }
  }

  const prices = await stripe.prices.list({ lookup_keys: items.map((item) => `${eventId}:${item.tierId}`), active: true, limit: 10 });
  for (const price of prices.data) {
    const tier = ordered.find((candidate) => `${eventId}:${candidate.tier_id}` === price.lookup_key);
    if (tier && (price.unit_amount !== tier.price_cents || price.currency !== tier.currency)) {
      console.error(JSON.stringify({ msg: "price_mismatch", eventId, tierId: tier.tier_id }));
      return json(req, { error: "This pass isn't available right now." }, 409);
    }
  }

  const cartLines = ordered.map((tier, i) => ({
    tierId: tier.tier_id,
    name: tier.name,
    unitCents: tier.price_cents,
    quantity: items[i].quantity,
    admits: tier.admits,
  }));

  let promo: (LivePromotion & { eligibleNames: string[] }) | null = null;
  if (promoCode !== "") {
    if (!(await rateLimit(`promo:${ip}`, 20, 600))) return json(req, { error: "Please wait a moment and try again." }, 429);
    if (promoCode === null) return json(req, { error: PROMO_INVALID, code: "promo_invalid" }, 422);
    const resolved = await findCartPromotion(eventId, promoCode, cartLines);
    if ("error" in resolved) return json(req, resolved, 422);
    promo = resolved;
  }

  const priced = priceCart(cartLines, promo ? { percent: promo.percent, eligibleTierIds: promo.eligibleTierIds } : null);
  let quoted: { tax: number; total: number; calculationId: string };
  try {
    quoted = await quoteCartTotal(
      stripe,
      currency,
      priced.lines.map((line: { discountedLineCents: number; tierId: string }) => ({ amount: line.discountedLineCents, reference: line.tierId })),
    );
  } catch (err) {
    console.error(JSON.stringify({ msg: "cart_tax_quote_failed", eventId, error: (err as Error).message?.slice(0, 200) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  if (quoted.total !== priced.discountedSubtotal + quoted.tax) {
    console.error(JSON.stringify({ msg: "cart_tax_total_mismatch", eventId }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }

  if (quote) {
    return json(req, {
      subtotal: priced.originalSubtotal,
      discount: priced.discount,
      discountedSubtotal: priced.discountedSubtotal,
      tax: quoted.tax,
      total: quoted.total,
      currency,
      totalAdmissions: priced.totalAdmissions,
      promo: promo
        ? {
            code: promo.code,
            percent: promo.percent,
            eligibleTicketTypes: promo.eligibleTierIds,
            eligibleNames: promo.eligibleNames,
            eligibleSubtotal: priced.eligibleSubtotal,
          }
        : null,
      lines: priced.lines.map((line: Record<string, unknown>) => ({
        ticket_type: line.tierId,
        name: line.name,
        unitCents: line.unitCents,
        quantity: line.quantity,
        admissions: line.totalAdmissions,
        lineSubtotal: line.originalLineCents,
        discount: line.discountCents,
        discountedSubtotal: line.discountedLineCents,
        promoEligible: line.promoEligible,
      })),
    });
  }

  const promoTiers = promo ? promoTierSnapshot(promo.eligibleTierIds) : "";
  if (promo && !promoTiers) return json(req, { error: "Something went wrong. Please try again." }, 500);

  const idempotencyKey = typeof body.idempotencyKey === "string" && UUID_RE.test(body.idempotencyKey)
    ? body.idempotencyKey
    : crypto.randomUUID();

  const snapshot = buildCartSnapshot({
    priced,
    tax: quoted.tax,
    currency,
    promo: promo ? { id: promo.id, code: promo.code, percent: promo.percent, eligibleTierIds: promo.eligibleTierIds } : null,
  });

  // One transaction locks and checks every ticket type. If any line cannot be
  // held, nothing is held.
  const reserved = await admin.rpc("reserve_cart", {
    p_event_id: eventId,
    p_items: items.map((item) => ({ tier_id: item.tierId, quantity: item.quantity })),
    p_idempotency_key: idempotencyKey,
    p_snapshot: snapshot,
    p_currency: currency,
    p_total_cents: snapshot.total,
  });
  if (reserved.error) return cartReserveError(req, reserved.error.message ?? "", tiers);

  const hold = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
  const expected = { amount: quoted.total, promoCode: promo?.code ?? "" };
  if (hold?.already) {
    const reused = await reuseIntent(req, idempotencyKey, hold.payment_intent_id, expected);
    if (reused) return reused;
  }

  const meta = stringMeta(ordered[0].metadata as Record<string, unknown>);
  const eventName = meta.omc_event_name ?? eventId;
  const summary = cartSummaryLabel(priced.lines);
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: quoted.total,
        currency,
        payment_method_types: ["card"],
        receipt_email: email,
        description: `${eventName} · ${summary}${promo ? ` · ${promo.code} ${promo.percent}% off eligible tickets` : ""}`.slice(0, 900),
        statement_descriptor_suffix: "ONE MORE",
        metadata: {
          ...meta,
          omc_event_id: eventId,
          // The cart snapshot lives in the database; the intent carries a reference and a short summary.
          omc_cart_id: hold.cart_id,
          omc_cart: cartMetaSummary(priced.lines),
          omc_total_admissions: String(priced.totalAdmissions),
          omc_name: name,
          omc_email: email,
          omc_expected_total: String(quoted.total),
          omc_promo_code: promo?.code ?? "",
          omc_promotion_id: promo?.id ?? "",
          omc_discount_percent: promo ? String(promo.percent) : "",
          omc_promo_eligible_tiers: promoTiers,
          omc_original_subtotal: String(priced.originalSubtotal),
          omc_discount_amount: String(priced.discount),
          omc_discounted_subtotal: String(priced.discountedSubtotal),
          omc_tax: String(quoted.tax),
        },
        hooks: { inputs: { tax: { calculation: quoted.calculationId } } },
        amount_details: {
          line_items: snapshot.lines.map((line: Record<string, unknown>) => ({
            product_name: `${eventName} · ${line.name}`.slice(0, 1000),
            product_code: String(line.tierId).replace(/[^a-z0-9]/gi, "").slice(0, 12),
            unit_cost: line.unitCents,
            quantity: line.quantity,
            ...((line.discountCents as number) > 0 ? { discount_amount: line.discountCents } : {}),
            tax: { total_tax_amount: line.taxCents },
          })),
        },
      } as Stripe.PaymentIntentCreateParams,
      { idempotencyKey },
    );
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/idempoten/i.test(message)) {
      const reused = await reuseIntent(req, idempotencyKey, null, expected);
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
  const linked = await admin
    .from("checkout_carts")
    .update({ payment_intent_id: intent.id })
    .eq("id", hold.cart_id)
    .is("payment_intent_id", null);
  if (attached.error || linked.error) {
    console.error(JSON.stringify({ msg: "hold_attach_failed", paymentIntentId: intent.id }));
  }
  console.log(JSON.stringify({
    msg: "payment_intent",
    paymentIntentId: intent.id,
    eventId,
    cart: cartMetaSummary(priced.lines),
    admissions: priced.totalAdmissions,
    amount: intent.amount,
    currency,
    promoCode: promo?.code ?? null,
    discount: priced.discount,
  }));
  return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
}

// A promotion applies to a cart when at least one line is on its allow-list.
// Only those lines are discounted; the rest stay at full price.
async function findCartPromotion(
  eventId: string,
  code: string,
  lines: { tierId: string }[],
): Promise<(LivePromotion & { eligibleNames: string[] }) | PromoRejection> {
  const { data, error } = await admin
    .from("promotions")
    .select("id, code, event_id, discount_type, discount_value, active, starts_at, expires_at, eligible_tier_ids")
    .eq("event_id", eventId)
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data || !promotionIsLive(data, eventId)) return { error: PROMO_INVALID, code: "promo_invalid" };
  const tiers = eligibleTierIds(data);
  if (promoHasNoEligibleLine(lines, tiers)) {
    return { error: await eligibilityCopy(eventId, data.code, tiers), code: PROMO_NOT_ELIGIBLE };
  }
  const { data: named, error: nameError } = await admin.from("tiers").select("tier_id, name").eq("event_id", eventId).in("tier_id", tiers);
  if (nameError) throw nameError;
  const namesById = new Map((named ?? []).map((row: { tier_id: string; name: string }) => [row.tier_id, row.name]));
  const eligibleNames = tiers.map((id) => namesById.get(id)).filter((value): value is string => typeof value === "string" && value.length > 0);
  return { id: data.id, code: data.code, percent: data.discount_value, eligibleTierIds: tiers, eligibleNames };
}

function cartReserveError(req: Request, message: string, tiers: Map<string, CartTier>): Response {
  const tierOf = (prefix: string) => {
    const id = message.split(`${prefix}:`)[1]?.split(/\s/)[0] ?? "";
    return { id, name: tiers.get(id)?.name ?? "That pass", max: tiers.get(id)?.max_per_order };
  };
  if (message.includes("sold_out")) {
    const tier = tierOf("sold_out");
    return json(req, { error: `${tier.name} is sold out.`, remaining: 0, ticket_type: tier.id }, 409);
  }
  if (message.includes("too_many_admissions")) return json(req, { error: CART_ERRORS.too_many_admissions, code: "too_many_admissions" }, 400);
  if (message.includes("too_many")) {
    const tier = tierOf("too_many");
    return json(req, { error: `Up to ${tier.max ?? 10} ${tier.name} per booking.` }, 400);
  }
  if (message.includes("unavailable")) return json(req, { error: "This pass isn't available." }, 404);
  if (/bad_quantity|bad_idempotency|bad_cart|duplicate_item|idempotency_mismatch/.test(message)) {
    return json(req, { error: "Choose how many passes." }, 400);
  }
  console.error(JSON.stringify({ msg: "reserve_cart_failed", error: message.slice(0, 200) }));
  return json(req, { error: "Something went wrong. Please try again." }, 500);
}
