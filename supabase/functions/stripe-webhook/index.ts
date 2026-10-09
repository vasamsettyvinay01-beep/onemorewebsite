// Stripe → passes. Signature is required. Fulfilment is idempotent on the
// payment intent, and the charged amount is checked against the tier price
// and a fresh tax quote before any ticket is created.

import Stripe from "npm:stripe@17";
import { admin } from "../_shared/http.ts";
import { readPartners, sendTicketEmail } from "../_shared/email.ts";
import { quoteTicketTotal } from "../_shared/pricing.ts";

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

  const amount = pi.amount_received || 0;
  const subtotal = tier.price_cents * quantity;
  if (pi.currency !== tier.currency || amount < subtotal || amount !== pi.amount) {
    await refundAndStop(paymentIntentId, "amount_mismatch");
    return;
  }
  const quoted = await quoteTicketTotal(stripe, tier.currency, tier.price_cents, quantity, meta.omc_tier_id);
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
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string | null; outcome: string };
  console.log(JSON.stringify({ msg: "fulfil", paymentIntentId, outcome: row?.outcome, orderId: row?.order_id }));
  if (!row || row.outcome === "oversold" || row.outcome === "underpaid" || row.outcome === "rejected") {
    await refundAndStop(paymentIntentId, row?.outcome ?? "rejected");
    return;
  }
  if (!row.order_id) return;
  await emailOrder(row.order_id, meta, email);
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

async function emailOrder(orderId: string, meta: Stripe.Metadata, email: string) {
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("status, access_token, emailed_at, purchaser_name, tier_name, tickets(guest_number, token, status)")
    .eq("id", orderId)
    .single();
  if (orderErr) throw orderErr;
  if (order.status === "refunded" || order.status === "disputed" || order.emailed_at) return;
  const tickets = [...order.tickets]
    .filter((ticket) => ticket.status !== "cancelled")
    .sort((a, b) => a.guest_number - b.guest_number);
  if (tickets.length === 0) return;

  const claim = await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId).is("emailed_at", null).select("id");
  if (claim.error) throw claim.error;
  if (!claim.data?.length) return;

  try {
    await sendTicketEmail({
      to: email,
      name: order.purchaser_name,
      eventName: meta.omc_event_name ?? "One More",
      chapter: meta.omc_chapter || undefined,
      dateLabel: meta.omc_event_date ?? "",
      timeLabel: meta.omc_event_time ?? "",
      venueName: meta.omc_venue_name ?? "",
      venueAddress: meta.omc_venue_address ?? "",
      mapUrl: meta.omc_map_url || undefined,
      heroUrl: meta.omc_hero_url || undefined,
      tierName: order.tier_name,
      invitation: meta.omc_invitation || undefined,
      partner: meta.omc_partner || undefined,
      notice: meta.omc_notice || undefined,
      partners: readPartners(meta.omc_partners),
      minimumAge: meta.omc_min_age ? Number(meta.omc_min_age) : undefined,
      accessToken: order.access_token,
      tickets,
    });
    console.log(JSON.stringify({ msg: "email_sent", orderId, tickets: tickets.length }));
  } catch (err) {
    await admin.from("orders").update({ emailed_at: null }).eq("id", orderId);
    throw err;
  }
}
