import QRCode from "npm:qrcode@1.5.4";
import { admin } from "./http.ts";
import { renderComplimentaryEmail } from "./complimentary-email.ts";
import { vipEventFromMetadata, vipPartnersFromMetadata } from "./vip.mjs";

const BRAND_ASSETS = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/brand`;

async function eventFacts(eventId: string) {
  const { data, error } = await admin.from("tiers").select("metadata").eq("event_id", eventId);
  if (error) throw error;
  const meta = (data ?? []).map((row) => row.metadata as Record<string, string> | null).find((row) => row?.omc_event_name);
  if (!meta) return null;
  return { event: vipEventFromMetadata(eventId, meta), partners: vipPartnersFromMetadata(meta.omc_partners) };
}

function qr(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    width: 432,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#0F0F10", light: "#F6F1E8" },
  });
}

export async function sendComplimentaryInvitation(
  orderId: string,
  options: { force?: boolean } = {},
): Promise<"sent" | "already_sent" | "not_sendable" | "none_valid"> {
  const { data: order, error } = await admin
    .from("orders")
    .select("event_id, status, emailed_at, purchaser_name, purchaser_email, quantity, is_complimentary, tickets(guest_number, token, status)")
    .eq("id", orderId)
    .single();
  if (error) throw error;
  if (!order.is_complimentary || order.status === "refunded") return "not_sendable";
  // Resend never creates passes. Only passes that are still valid go out.
  const tickets = [...order.tickets].filter((ticket) => ticket.status === "valid").sort((a, b) => a.guest_number - b.guest_number);
  if (!tickets.length) return "none_valid";
  if (order.emailed_at && !options.force) return "already_sent";

  const claim = options.force
    ? await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId).select("id")
    : await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId).is("emailed_at", null).select("id");
  if (claim.error) throw claim.error;
  if (!claim.data?.length) return "already_sent";

  try {
    const facts = await eventFacts(order.event_id);
    if (!facts) throw new Error("complimentary_event_metadata_missing");
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("TICKETS_FROM_EMAIL");
    if (!apiKey || !from) throw new Error("RESEND_API_KEY / TICKETS_FROM_EMAIL not set");
    const pngs = await Promise.all(tickets.map((ticket) => qr(ticket.token)));
    const { subject, html, text } = renderComplimentaryEmail({
      hostName: order.purchaser_name ?? "Guest",
      count: tickets.length,
      event: facts.event,
      sealUrl: `${BRAND_ASSETS}/seal.png`,
      passes: tickets.map((ticket, index) => ({ number: ticket.guest_number, qrSrc: `cid:comp-${ticket.guest_number}` })),
      partners: facts.partners.map((partner) => ({ ...partner, logoUrl: `${BRAND_ASSETS}/${partner.logo}` })),
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [order.purchaser_email],
        reply_to: Deno.env.get("TICKETS_REPLY_TO") ?? "contact@theonemorecompany.com",
        subject,
        html,
        text,
        attachments: tickets.map((ticket, index) => ({
          filename: `pass-${String(ticket.guest_number).padStart(2, "0")}.png`,
          content: pngs[index].split(",")[1],
          content_id: `comp-${ticket.guest_number}`,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return "sent";
  } catch (err) {
    await admin.from("orders").update({ emailed_at: null }).eq("id", orderId);
    throw err;
  }
}

export async function renderComplimentaryPreview(input: { hostName: string; count: number }, eventId: string) {
  const facts = await eventFacts(eventId);
  if (!facts) return null;
  const passes = await Promise.all(
    Array.from({ length: input.count }, async (_, index) => ({
      number: index + 1,
      qrSrc: await qr(`PREVIEW-NOT-VALID-${index + 1}`),
    })),
  );
  return renderComplimentaryEmail({
    hostName: input.hostName,
    count: input.count,
    event: facts.event,
    sealUrl: "/brand/logo/one-more-seal.svg",
    passes,
    partners: facts.partners.map((partner) => ({ ...partner, logoUrl: `/brand/${partner.logo}` })),
  });
}
