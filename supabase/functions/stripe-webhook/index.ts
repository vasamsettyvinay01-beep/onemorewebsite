// Stripe → passes. Signature is required. Fulfilment is idempotent on the
// payment intent, and the charged amount is checked against the tier price,
// any promo recorded by checkout, and a fresh tax quote before any ticket is created.

import Stripe from "npm:stripe@17";
import { admin } from "../_shared/http.ts";
import { sendOrderTicketEmail } from "../_shared/order-email.ts";
import { quoteTicketTotal } from "../_shared/pricing.ts";
import { normalizePromoCode, priceTickets, promoSnapshotAllowsTier } from "../_shared/promo.mjs";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Invalid signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.warn(JSON.stringify({ msg: "webhook_rejected", error: (err as Error).message?.slice(0, 160) }));
    return new Response("Invalid signature", { status: 400 });
  }

  const keyLive = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").includes("_live_");
  if (event.livemode !== keyLive) {
    console.warn(JSON.stringify({ msg: "livemode_mismatch", eventId: event.id, livemode: event.livemode }));
    return new Response("Mode mismatch", { status: 400 });
  }

  const seen = await admin.from("stripe_events").insert({ id: event.id, type: event.type }).select("id");
  if (seen.error?.code === "23505") return new Response("ok");
  if (seen.error) {
    console.error(JSON.stringify({ msg: "webhook_idempotency_failed", eventId: event.id }));
    return new Response("Handler error", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid") break;
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (!pi) throw new Error("Session has no payment");
        await fulfil(pi, session.id);
        break;
      }
      case "payment_intent.succeeded":
        await fulfil((event.data.object as Stripe.PaymentIntent).id);
        break;
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (pi) {
          const { error } = await admin.rpc("cancel_order_by_payment_intent", {
            p_payment_intent: pi,
            p_full: charge.refunded,
          });
          if (error) throw error;
          console.log(JSON.stringify({ msg: "refund_applied", paymentIntentId: pi, full: charge.refunded }));
        }
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const pi = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
        if (pi) {
          const { error } = await admin.rpc("mark_payment_disputed", { p_payment_intent: pi });
          if (error) throw error;
          console.log(JSON.stringify({ msg: "dispute_applied", paymentIntentId: pi }));
        }
        break;
      }
    }
  } catch (err) {
    await admin.from("stripe_events").delete().eq("id", event.id);
    console.error(JSON.stringify({ msg: "webhook_failed", eventId: event.id, type: event.type, error: (err as Error).message?.slice(0, 300) }));
    return new Response("Handler error", { status: 500 });
  }

  console.log(JSON.stringify({ msg: "webhook_ok", eventId: event.id, type: event.type }));
  return new Response("ok");
});

async function fulfil(paymentIntentId: string, sessionId?: string) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== "succeeded") return;
  const meta = pi.metadata ?? {};
  if (!meta.omc_event_id || !meta.omc_tier_id) return;

  const email = meta.omc_email || pi.receipt_email;
  const quantity = Number(meta.omc_quantity ?? 1);
  if (!email || !Number.isInteger(quantity) || quantity < 1) throw new Error("Booking is missing a guest");

  const { data: tier, error: tierErr } = await admin
    .from("tiers")
    .select("price_cents, currency, admits, max_per_order")
    .eq("event_id", meta.omc_event_id)
    .eq("tier_id", meta.omc_tier_id)
    .maybeSingle();
  if (tierErr) throw tierErr;
  if (!tier) throw new Error("Unknown pass");

  const promo = await promoFromIntent(meta);
  if (promo === "invalid") {
    await refundAndStop(paymentIntentId, "promo_mismatch");
    return;
  }
  // The allow-list is the one checkout froze on the PaymentIntent. Reading the
  // promotions row again would reject a charge that was valid when it was created.
  // A missing snapshot is an older PaymentIntent and keeps the previous behaviour.
  if (promo && promoSnapshotAllowsTier(meta.omc_promo_eligible_tiers ?? "", meta.omc_tier_id) === "ineligible") {
    await refundAndStop(paymentIntentId, "promo_ineligible");
    return;
  }

  const amount = pi.amount_received || 0;
  const priced = priceTickets({ unitCents: tier.price_cents, quantity, percent: promo?.percent ?? 0 });
  if (pi.currency !== tier.currency || amount < priced.discountedSubtotal || amount !== pi.amount) {
    await refundAndStop(paymentIntentId, "amount_mismatch");
    return;
  }
  const quoted = await quoteTicketTotal(stripe, tier.currency, priced.discountedSubtotal, meta.omc_tier_id);
  if (amount < quoted.total) {
    await refundAndStop(paymentIntentId, "tax_mismatch");
    return;
  }

  const { data, error } = await admin.rpc("create_order_with_tickets", {
    p_session_id: sessionId ?? paymentIntentId,
    p_payment_intent: paymentIntentId,
    p_event_id: meta.omc_event_id,
    p_tier_id: meta.omc_tier_id,
    p_tier_name: meta.omc_tier_name ?? meta.omc_tier_id,
    p_quantity: quantity,
    p_admits: tier.admits,
    p_name: meta.omc_name || null,
    p_email: email,
    p_amount_total: amount,
    p_currency: pi.currency,
    ...(promo
      ? { p_promotion_id: promo.id, p_promo_code: promo.code, p_discount_percent: promo.percent }
      : {}),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string | null; outcome: string };
  console.log(JSON.stringify({
    msg: "fulfil",
    paymentIntentId,
    outcome: row?.outcome,
    orderId: row?.order_id,
    promoCode: promo?.code ?? null,
    discount: priced.discount,
  }));
  if (!row || row.outcome === "oversold" || row.outcome === "underpaid" || row.outcome === "rejected") {
    await refundAndStop(paymentIntentId, row?.outcome ?? "rejected");
    return;
  }
  if (!row.order_id) return;
  await sendOrderTicketEmail(row.order_id, meta, paymentIntentId);
}

// Checkout writes the promo into PaymentIntent metadata with the secret key, so
// the browser cannot set it. It is still checked against the promotions row.
// The percent is the snapshot the customer was charged, so a promotion disabled
// after payment does not reject a payment that already succeeded.
async function promoFromIntent(
  meta: Record<string, string>,
): Promise<{ id: string; code: string; percent: number } | null | "invalid"> {
  const raw = meta.omc_promo_code ?? "";
  if (!raw && !meta.omc_promotion_id && !meta.omc_discount_percent) return null;
  const code = normalizePromoCode(raw);
  const percent = Number(meta.omc_discount_percent);
  const id = meta.omc_promotion_id ?? "";
  if (!code || code !== raw || !Number.isInteger(percent) || percent < 1 || percent > 100) return "invalid";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return "invalid";
  const { data, error } = await admin
    .from("promotions")
    .select("id, code, event_id, discount_type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.code !== code || data.event_id !== meta.omc_event_id || data.discount_type !== "percentage") return "invalid";
  return { id: data.id, code: data.code, percent };
}

async function refundAndStop(paymentIntentId: string, reason: string) {
  console.error(JSON.stringify({ msg: "refund_instead_of_tickets", paymentIntentId, reason }));
  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `omc-refund-${paymentIntentId}` },
    );
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (!/already been refunded|charge_already_refunded/i.test(message)) throw err;
  }
  await admin.rpc("cancel_order_by_payment_intent", { p_payment_intent: paymentIntentId, p_full: true });
}
