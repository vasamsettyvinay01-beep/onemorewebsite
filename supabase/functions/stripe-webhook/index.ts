// Stripe → tickets. Configured in Stripe as the endpoint for
// checkout.session.completed, checkout.session.async_payment_succeeded and charge.refunded.
//
// Tier details come from metadata on the Stripe Price (written by
// scripts/stripe-setup.ts), never from anything the buyer can edit in the URL.

import Stripe from "npm:stripe@17";
import { admin } from "../_shared/http.ts";
import { sendTicketEmail } from "../_shared/email.ts";

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
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "paid") await fulfil(session);
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

async function fulfil(session: Stripe.Checkout.Session) {
  const email = session.customer_details?.email;
  if (!email) throw new Error(`Session ${session.id} has no email`);

  const items = await stripe.checkout.sessions.listLineItems(session.id, { expand: ["data.price"], limit: 20 });
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  let index = 0;
  for (const item of items.data) {
    const meta = item.price?.metadata ?? {};
    if (!meta.omc_event_id || !meta.omc_tier_id) continue; // not a One More ticket
    const first = index === 0;
    const key = first ? session.id : `${session.id}#${index}`;
    index++;

    const { data, error } = await admin.rpc("create_order_with_tickets", {
      p_session_id: key,
      p_payment_intent: first ? pi : null,
      p_event_id: meta.omc_event_id,
      p_tier_id: meta.omc_tier_id,
      p_tier_name: meta.omc_tier_name ?? meta.omc_tier_id,
      p_quantity: item.quantity ?? 1,
      p_admits: Number(meta.omc_admits ?? 1),
      p_name: session.customer_details?.name ?? null,
      p_email: email,
      p_amount_total: item.amount_total,
      p_currency: item.currency,
    });
    if (error) throw error;
    const orderId: string = data[0].order_id;

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("access_token, emailed_at, purchaser_name, tier_name, tickets(guest_number, token)")
      .eq("id", orderId)
      .single();
    if (orderErr) throw orderErr;

    if (!order.emailed_at) {
      await sendTicketEmail({
        to: email,
        name: order.purchaser_name,
        eventName: meta.omc_event_name ?? "One More",
        eventWhen: meta.omc_event_when ?? "",
        eventWhere: meta.omc_event_where ?? "",
        tierName: order.tier_name,
        minimumAge: meta.omc_min_age ? Number(meta.omc_min_age) : undefined,
        accessToken: order.access_token,
        tickets: [...order.tickets].sort((a, b) => a.guest_number - b.guest_number),
      });
      await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId);
    }

    if (meta.omc_capacity) await closeLinkIfSoldOut(session, meta.omc_event_id, meta.omc_tier_id, Number(meta.omc_capacity));
  }
}

/** Stops a capped tier (e.g. Early Bird) from selling past its capacity. */
async function closeLinkIfSoldOut(session: Stripe.Checkout.Session, eventId: string, tierId: string, capacity: number) {
  const linkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  if (!linkId) return;
  const { data, error } = await admin
    .from("orders")
    .select("quantity")
    .eq("event_id", eventId)
    .eq("tier_id", tierId)
    .neq("status", "refunded");
  if (error) throw error;
  const sold = data.reduce((sum, o) => sum + o.quantity, 0);
  if (sold >= capacity) {
    await stripe.paymentLinks.update(linkId, { active: false });
    console.log(`Tier ${eventId}/${tierId} reached ${sold}/${capacity}; payment link ${linkId} deactivated`);
  }
}
