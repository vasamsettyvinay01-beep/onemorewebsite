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

const BRAND_ASSETS = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/brand`;

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
