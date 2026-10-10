import QRCode from "npm:qrcode@1.5.4";
import { SITE_URL } from "./http.ts";
import { renderPassEmail, type PassEmail } from "./pass-email.ts";

/** `omc_partners` metadata → marks for the foot of the pass. Logo paths are storage keys. */
export function readPartners(raw: string | undefined): PassEmail["partners"] {
  if (!raw) return undefined;
  try {
    const rows = JSON.parse(raw) as { name?: string; logo?: string; w?: number; h?: number; note?: string }[];
    if (!Array.isArray(rows)) return undefined;
    return rows
      .filter((r) => r?.name && r?.logo)
      .map((r) => ({
        name: r.name!,
        logo: r.logo!,
        width: Number(r.w) || 2,
        height: Number(r.h) || 1,
        note: r.note || undefined,
      }));
  } catch {
    return undefined;
  }
}

export type TicketEmail = Omit<PassEmail, "passes" | "ticketsUrl" | "sealUrl"> & {
  to: string;
  accessToken: string;
  tickets: { guest_number: number; token: string }[];
};

export interface SaleNotification {
  orderId: string;
  paymentIntentId: string;
  eventName: string;
  purchaserName: string | null;
  purchaserEmail: string;
  tierName: string;
  quantity: number;
  guestCount: number;
  amountTotal: number;
  currency: string;
}

const BRAND_ASSETS = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/brand`;
const esc = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function qrPng(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    width: 432,
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#0F100F", light: "#F4F1EA" },
  });
}

/** Sends the passes with each QR inline, so they work at the door even without signal. */
export async function sendTicketEmail(t: TicketEmail): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TICKETS_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / TICKETS_FROM_EMAIL not set");

  const pngs = await Promise.all(t.tickets.map((ticket) => qrPng(ticket.token)));
  const { subject, html, text } = renderPassEmail({
    ...t,
    partners: t.partners?.map((p) => ({
      ...p,
      logo: p.logo.startsWith("http") ? p.logo : `${BRAND_ASSETS}/${p.logo.replace(/^\//, "")}`,
    })),
    sealUrl: `${BRAND_ASSETS}/seal.png`,
    ticketsUrl: `${SITE_URL}/tickets/?o=${t.accessToken}`,
    passes: t.tickets.map((ticket) => ({ ...ticket, qrSrc: `cid:pass-${ticket.guest_number}` })),
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [t.to],
      reply_to: Deno.env.get("TICKETS_REPLY_TO") ?? "contact@theonemorecompany.com",
      subject,
      html,
      text,
      attachments: t.tickets.map((ticket, i) => ({
        filename: `pass-${String(ticket.guest_number).padStart(2, "0")}.png`,
        content: pngs[i].split(",")[1],
        content_id: `pass-${ticket.guest_number}`,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/** Sends the owner a compact receipt whenever a paid order is fulfilled. */
export async function sendSaleNotification(sale: SaleNotification): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TICKETS_FROM_EMAIL");
  const to = Deno.env.get("SALES_NOTIFICATION_EMAIL");
  if (!apiKey || !from || !to) throw new Error("Sale notification email secrets not set");

  const total = money(sale.amountTotal, sale.currency);
  const buyer = sale.purchaserName?.trim() || "Guest";
  const subject = `New ticket sale — ${sale.quantity} × ${sale.tierName} — ${total}`;
  const rows = [
    ["Event", sale.eventName],
    ["Buyer", buyer],
    ["Email", sale.purchaserEmail],
    ["Pass", sale.tierName],
    ["Quantity", String(sale.quantity)],
    ["Guests admitted", String(sale.guestCount)],
    ["Paid", total],
    ["Order", sale.orderId],
    ["Payment", sale.paymentIntentId],
  ];
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;color:#8f8b82;font:600 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;border-bottom:1px solid #28251f">${esc(label)}</td><td style="padding:8px 12px;color:#eceae4;font:400 14px Arial,sans-serif;border-bottom:1px solid #28251f">${esc(value)}</td></tr>`,
    )
    .join("");
  const text = [`New ticket sale — ${sale.eventName}`, "", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: sale.purchaserEmail,
      subject,
      html: `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0a09"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0f100f;border:1px solid #bb9b63"><tr><td style="padding:22px 24px 14px"><div style="color:#bb9b63;font:600 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:.24em">New booking</div><div style="margin-top:8px;color:#eceae4;font:400 30px Georgia,serif">${esc(sale.eventName)}</div><div style="margin-top:6px;color:#d8c196;font:400 17px Georgia,serif">${esc(total)}</div></td></tr><tr><td style="padding:0 12px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${htmlRows}</table></td></tr></table></td></tr></table></body></html>`,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend sale notification ${res.status}: ${await res.text()}`);
}
