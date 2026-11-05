import { admin } from "./http.ts";
import { money, readPartners, sendSaleNotification, sendTicketEmail } from "./email.ts";
import { promoLabel } from "./promo.mjs";

export type OrderEmailMetadata = Record<string, string | undefined>;

interface OrderItem {
  position: number;
  tier_id: string;
  display_name_snapshot: string;
  quantity: number;
  total_admissions: number;
  promo_eligible: boolean;
}

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
    .select("status, access_token, emailed_at, purchaser_name, purchaser_email, tier_name, quantity, amount_total, currency, promo_code, discount_percent, original_subtotal_cents, discount_amount_cents, tax_cents, tickets(guest_number, token, status, tier_id), order_items(position, tier_id, display_name_snapshot, quantity, total_admissions, promo_eligible)")
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

  const label = promoLabel(order.promo_code, order.discount_percent);
  const promoted = label && order.original_subtotal_cents != null && order.discount_amount_cents != null && order.tax_cents != null;

  // A mixed-ticket order has order_items. Its email groups passes by ticket type and
  // always carries a receipt; a code is described by the lines it actually discounted.
  const items = [...((order.order_items ?? []) as OrderItem[])].sort((a, b) => a.position - b.position);
  const isCart = items.length > 0 && order.original_subtotal_cents != null && order.discount_amount_cents != null && order.tax_cents != null;
  const discountedNames = items.filter((item) => item.promo_eligible).map((item) => item.display_name_snapshot.toUpperCase());
  const cartPromoLabel = isCart && order.promo_code && order.discount_percent != null && discountedNames.length
    ? `${order.promo_code} — ${order.discount_percent}% OFF ${discountedNames.join(" + ")}`
    : undefined;
  const groups = isCart
    ? items
        .map((item) => ({
          tierName: item.display_name_snapshot,
          tickets: tickets.filter((ticket) => ticket.tier_id === item.tier_id).map(({ guest_number, token }) => ({ guest_number, token })),
        }))
        .filter((group) => group.tickets.length > 0)
    : undefined;
  const receipt = isCart
    ? {
        ...(cartPromoLabel ? { promo: cartPromoLabel } : {}),
        originalSubtotal: money(order.original_subtotal_cents!, order.currency),
        ...(cartPromoLabel
          ? { discount: `-${money(order.discount_amount_cents!, order.currency)}`, discountLabel: `${order.promo_code} discount` }
          : {}),
        tax: money(order.tax_cents!, order.currency),
        total: money(order.amount_total, order.currency),
        totalLabel: "Total paid",
      }
    : promoted
    ? {
        promo: label,
        originalSubtotal: money(order.original_subtotal_cents!, order.currency),
        discount: `-${money(order.discount_amount_cents!, order.currency)}`,
        tax: money(order.tax_cents!, order.currency),
        total: money(order.amount_total, order.currency),
      }
    : undefined;

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
      groups,
      receipt,
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
          promo: promoted && !isCart
            ? { label, originalSubtotal: order.original_subtotal_cents!, discount: order.discount_amount_cents!, tax: order.tax_cents! }
            : undefined,
          cart: isCart
            ? {
                items: items.map((item) => ({ name: item.display_name_snapshot, quantity: item.quantity, admissions: item.total_admissions })),
                promoLabel: cartPromoLabel,
                originalSubtotal: order.original_subtotal_cents!,
                discount: order.discount_amount_cents!,
                tax: order.tax_cents!,
              }
            : undefined,
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
