// Stripe → passes. Configured in Stripe as the endpoint for
// checkout.session.completed, payment_intent.succeeded and charge.refunded.
//
// Everything about the order (tier, quantity, guest count, event details) is
// read from PaymentIntent metadata written server-side by the `checkout`
// function — never from anything the buyer controls.

import Stripe from "npm:stripe@17";
import { admin } from "../_shared/http.ts";
import { readPartners, sendTicketEmail } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      req.headers.get("stripe-signature") ?? "",
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.warn("Rejected webhook:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await fulfilSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.omc_source === "embedded") break;
        await fulfil(pi);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (pi) {
          const { error } = await admin.rpc("cancel_order_by_payment_intent", {
            p_payment_intent: pi,
            p_full: charge.refunded,
          });
          if (error) throw error;
        }
        break;
      }
    }
  } catch (err) {
    // 500 makes Stripe retry; fulfilment is idempotent.
    console.error(`Failed handling ${event.type} ${event.id}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok");
});

async function fulfilSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return;
  const meta = session.metadata ?? {};
  const email = session.customer_details?.email || meta.omc_email;
  const named = session.custom_fields?.find((field) => field.key === "guest_name")?.text?.value?.trim();
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) throw new Error(`Session ${session.id} has no payment`);
  await issue({
    sessionId: session.id,
    paymentIntentId: pi,
    meta,
    email,
    name: named || session.customer_details?.name || meta.omc_name || null,
    amount: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  });
}

async function fulfil(pi: Stripe.PaymentIntent) {
  const meta = pi.metadata ?? {};
  await issue({
    sessionId: pi.id,
    paymentIntentId: pi.id,
    meta,
    email: meta.omc_email || pi.receipt_email,
    name: meta.omc_name || null,
    amount: pi.amount_received || pi.amount,
    currency: pi.currency,
  });
}

async function issue(input: {
  sessionId: string;
  paymentIntentId: string;
  meta: Stripe.Metadata;
  email: string | null | undefined;
  name: string | null;
  amount: number;
  currency: string;
}) {
  const { meta } = input;
  if (!meta.omc_event_id || !meta.omc_tier_id) return; // not a One More booking
  if (!input.email) throw new Error(`${input.sessionId} has no email`);

  const { data, error } = await admin.rpc("create_order_with_tickets", {
    p_session_id: input.sessionId,
    p_payment_intent: input.paymentIntentId,
    p_event_id: meta.omc_event_id,
    p_tier_id: meta.omc_tier_id,
    p_tier_name: meta.omc_tier_name ?? meta.omc_tier_id,
    p_quantity: Number(meta.omc_quantity ?? 1),
    p_admits: Number(meta.omc_admits ?? 1),
    p_name: input.name,
    p_email: input.email,
    p_amount_total: input.amount,
    p_currency: input.currency,
  });
  if (error) throw error;
  const orderId: string = data[0].order_id;

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("status, access_token, emailed_at, purchaser_name, tier_name, tickets(guest_number, token)")
    .eq("id", orderId)
    .single();
  if (orderErr) throw orderErr;
  if (order.emailed_at || order.status === "refunded") return;

  await sendTicketEmail({
    to: input.email,
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
    tickets: [...order.tickets].sort((a, b) => a.guest_number - b.guest_number),
  });
  await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId);
}
