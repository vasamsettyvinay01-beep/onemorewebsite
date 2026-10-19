import { admin } from "./http.ts";
import { readPartners, sendSaleNotification, sendTicketEmail } from "./email.ts";

export type OrderEmailMetadata = Record<string, string | undefined>;

export interface OrderEmailResult {
  status: "sent" | "already_sent" | "not_sendable";
  ticketCount: number;
}

export async function sendOrderTicketEmail(
  orderId: string,
  metadata: OrderEmailMetadata,
  paymentIntentId?: string,
): Promise<OrderEmailResult> {
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("status, access_token, emailed_at, purchaser_name, purchaser_email, tier_name, quantity, amount_total, currency, tickets(guest_number, token, status)")
    .eq("id", orderId)
    .single();
  if (orderErr) throw orderErr;
  if (order.status === "refunded" || order.status === "disputed") {
    return { status: "not_sendable", ticketCount: 0 };
  }

  const tickets = [...order.tickets]
    .filter((ticket) => ticket.status !== "cancelled")
    .sort((a, b) => a.guest_number - b.guest_number);
  if (tickets.length === 0) return { status: "not_sendable", ticketCount: 0 };
  if (order.emailed_at) return { status: "already_sent", ticketCount: tickets.length };

  const claim = await admin
    .from("orders")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("emailed_at", null)
    .select("id");
  if (claim.error) throw claim.error;
  if (!claim.data?.length) return { status: "already_sent", ticketCount: tickets.length };

  try {
    await sendTicketEmail({
      to: order.purchaser_email,
      name: order.purchaser_name,
      eventName: metadata.omc_event_name ?? "One More",
      chapter: metadata.omc_chapter || undefined,
      dateLabel: metadata.omc_event_date ?? "",
      timeLabel: metadata.omc_event_time ?? "",
      venueName: metadata.omc_venue_name ?? "",
      venueAddress: metadata.omc_venue_address ?? "",
      mapUrl: metadata.omc_map_url || undefined,
      heroUrl: metadata.omc_hero_url || undefined,
      tierName: order.tier_name,
      invitation: metadata.omc_invitation || undefined,
      partner: metadata.omc_partner || undefined,
      notice: metadata.omc_notice || undefined,
      partners: readPartners(metadata.omc_partners),
      minimumAge: metadata.omc_min_age ? Number(metadata.omc_min_age) : undefined,
      accessToken: order.access_token,
      tickets,
    });
    console.log(JSON.stringify({ msg: "email_sent", orderId, tickets: tickets.length }));

    if (paymentIntentId) {
      try {
        await sendSaleNotification({
          orderId,
          paymentIntentId,
          eventName: metadata.omc_event_name ?? "One More",
          purchaserName: order.purchaser_name,
          purchaserEmail: order.purchaser_email,
          tierName: order.tier_name,
          quantity: order.quantity,
          guestCount: tickets.length,
          amountTotal: order.amount_total,
          currency: order.currency,
        });
        console.log(JSON.stringify({ msg: "sale_notification_sent", orderId }));
      } catch (err) {
        console.error(JSON.stringify({
          msg: "sale_notification_failed",
          orderId,
          error: (err as Error).message?.slice(0, 240),
        }));
      }
    }
    return { status: "sent", ticketCount: tickets.length };
  } catch (err) {
    await admin.from("orders").update({ emailed_at: null }).eq("id", orderId);
    throw err;
  }
}
