import QRCode from "npm:qrcode@1.5.4";
import { admin, SITE_URL } from "./http.ts";
import { renderVipEmail, type VipEmailEvent } from "./vip-email.ts";
import { vipEventFromMetadata, vipPartnersFromMetadata } from "./vip.mjs";

const BRAND_ASSETS = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/brand`;

export interface VipPartner {
  name: string;
  logo: string;
  width: number;
  height: number;
}

/** Event facts and partners come from the production tier metadata, the same source as ticket emails. */
export async function loadVipEvent(eventId: string): Promise<{ event: VipEmailEvent; partners: VipPartner[] } | null> {
  const { data, error } = await admin.from("tiers").select("metadata").eq("event_id", eventId);
  if (error) throw error;
  const meta = (data ?? []).map((row) => row.metadata as Record<string, string> | null).find((row) => row?.omc_event_name);
  if (!meta) return null;
  return { event: vipEventFromMetadata(eventId, meta), partners: vipPartnersFromMetadata(meta.omc_partners) };
}

export function vipPassUrl(token: string): string {
  return `${SITE_URL}/vip#${token}`;
}

/** Black modules on ivory with a four-module quiet zone. Never tinted, never branded. */
export function vipQr(value: string, width = 564): Promise<string> {
  return QRCode.toDataURL(value, {
    width,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#0F0F10", light: "#F6F1E8" },
  });
}

export interface VipDelivery {
  to: string;
  hostName: string;
  table: string;
  capacity: number;
  code: string;
  token: string;
}

export async function sendVipInvitationEmail(input: VipDelivery, eventId: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TICKETS_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / TICKETS_FROM_EMAIL not set");
  const loaded = await loadVipEvent(eventId);
  if (!loaded) throw new Error("vip_event_metadata_missing");

  const png = await vipQr(input.token);
  const { subject, html, text } = renderVipEmail({
    hostName: input.hostName,
    table: input.table,
    capacity: input.capacity,
    event: loaded.event,
    code: input.code,
    passUrl: vipPassUrl(input.token),
    qrSrc: "cid:vip-access",
    sealUrl: `${BRAND_ASSETS}/seal.png`,
    partners: loaded.partners.map((partner) => ({ ...partner, logoUrl: `${BRAND_ASSETS}/${partner.logo}` })),
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      reply_to: Deno.env.get("TICKETS_REPLY_TO") ?? "contact@theonemorecompany.com",
      subject,
      html,
      text,
      attachments: [{ filename: "vip-access.png", content: png.split(",")[1], content_id: "vip-access" }],
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Preview for the super admin. Assets resolve against the operations page, so the page CSP allows them. */
export async function renderVipPreview(input: Omit<VipDelivery, "to" | "token" | "code">, eventId: string) {
  const loaded = await loadVipEvent(eventId);
  if (!loaded) return null;
  const code = "VIP-SAMPLE";
  const qr = await vipQr("PREVIEW-NOT-VALID-FOR-ENTRY", 376);
  const email = renderVipEmail({
    hostName: input.hostName,
    table: input.table,
    capacity: input.capacity,
    event: loaded.event,
    code,
    passUrl: "#preview",
    qrSrc: qr,
    sealUrl: "/brand/logo/one-more-seal.svg",
    partners: loaded.partners.map((partner) => ({ ...partner, logoUrl: `/brand/${partner.logo}` })),
  });
  return { email, event: loaded.event, partners: loaded.partners, code };
}
