import QRCode from "npm:qrcode@1.5.4";
import { SITE_URL } from "./http.ts";
import { renderHousePartyEmail } from "./house-party-pass.mjs";

const BRAND_ASSETS = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/brand`;

export async function sendHousePartyEmail(input: {
  to: string;
  fullName: string;
  partySize: number;
  guestNames: string[];
  code: string;
  token: string;
}): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TICKETS_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / TICKETS_FROM_EMAIL not set");

  const site = SITE_URL || "https://theonemorecompany.com";
  const passUrl = `${site}/house-party/pass?t=${input.token}`;
  const png = await QRCode.toDataURL(passUrl, {
    width: 432,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0F0F10", light: "#F6F1E8" },
  });
  const message = renderHousePartyEmail({
    ...input,
    passUrl,
    nov7Url: `${site}/checkout?event=diwali-night`,
    sealUrl: `${BRAND_ASSETS}/seal.png`,
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      reply_to: Deno.env.get("TICKETS_REPLY_TO") ?? "contact@theonemorecompany.com",
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [{ filename: "house-party-pass.png", content: png.split(",")[1], content_id: "house-party-pass" }],
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}
