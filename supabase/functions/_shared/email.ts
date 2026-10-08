import QRCode from "npm:qrcode@1.5.4";
import { SITE_URL } from "./http.ts";

export interface TicketEmail {
  to: string;
  name: string | null;
  eventName: string;
  eventWhen: string;
  eventWhere: string;
  tierName: string;
  minimumAge?: number;
  accessToken: string;
  tickets: { guest_number: number; token: string }[];
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends the tickets with each QR inline, so they work at the door even without signal. */
export async function sendTicketEmail(t: TicketEmail): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TICKETS_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / TICKETS_FROM_EMAIL not set");

  const link = `${SITE_URL}/tickets/?o=${t.accessToken}`;
  const total = t.tickets.length;

  const attachments = await Promise.all(
    t.tickets.map(async (ticket) => {
      const dataUrl: string = await QRCode.toDataURL(ticket.token, { width: 480, margin: 2, errorCorrectionLevel: "M" });
      return {
        filename: `ticket-${ticket.guest_number}.png`,
        content: dataUrl.split(",")[1],
        content_id: `qr-${ticket.guest_number}`,
      };
    }),
  );

  const qrBlocks = t.tickets
    .map(
      (ticket) => `
      <tr><td align="center" style="padding:24px 0 8px">
        <img src="cid:qr-${ticket.guest_number}" width="240" height="240" alt="Ticket QR code ${ticket.guest_number}" style="display:block;background:#fff;border-radius:8px">
        <p style="margin:10px 0 0;font:600 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#bb9b63">
          Guest ${ticket.guest_number} of ${total}
        </p>
      </td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#0b0c0a;color:#ecead4">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0a">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
        <tr><td style="font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#bb9b63">The One More Company</td></tr>
        <tr><td style="padding-top:18px;font:400 40px/1 Georgia,serif;color:#ecead4">${escape(t.eventName)}</td></tr>
        <tr><td style="padding-top:10px;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#a9a796">
          ${escape(t.eventWhen)}<br>${escape(t.eventWhere)}<br>${escape(t.tierName)} · ${total} ${total === 1 ? "guest" : "guests"}
        </td></tr>
        <tr><td style="padding-top:22px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#ecead4">
          ${t.name ? `${escape(t.name.split(" ")[0])}, you're in.` : "You're in."}
          Show ${total === 1 ? "this code" : "one code per guest"} at the door. Each code admits one person, once.
        </td></tr>
        ${qrBlocks}
        <tr><td align="center" style="padding:28px 0 8px">
          <a href="${link}" style="display:inline-block;padding:14px 28px;background:#bb9b63;color:#0b0c0a;font:700 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;text-decoration:none;border-radius:999px">View tickets</a>
        </td></tr>
        <tr><td style="padding-top:24px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#77756a">
          Don't share these codes — the first scan gets in.${t.minimumAge ? ` ${t.minimumAge}+ with valid ID.` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [t.to],
      subject: `Your tickets — ${t.eventName}`,
      html,
      text: `You're in for ${t.eventName}.\n${t.eventWhen}\n${t.eventWhere}\n\nYour tickets: ${link}\n\nEach code admits one person, once.`,
      attachments,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
