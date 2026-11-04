/**
 * The private VIP invitation email. Matte black stock, one gold hairline at a
 * time, serif for the voice, small tracked sans for facts, one ivory QR card.
 * Tables and inline styles carry the whole hierarchy; the <style> block only
 * tightens padding on phones, so clients that drop it still read correctly.
 * Nothing here may mention money: the guest sees an invitation, not a ticket.
 */
import { partnerBox } from "./vip.mjs";

export interface VipEmailEvent {
  title: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  address: string;
  mapUrl: string;
  minAge: number | null;
}

export interface VipEmailInput {
  hostName: string;
  table: string;
  capacity: number;
  event: VipEmailEvent;
  code: string;
  passUrl: string;
  qrSrc: string;
  sealUrl: string;
  partners: { name: string; logoUrl: string; width: number; height: number }[];
  contactEmail?: string;
}

const C = {
  page: "#0B0B0C",
  stock: "#0F0F10",
  gold: "#C6A15B",
  goldDim: "#7A6540",
  hair: "#26231F",
  ivory: "#F6F1E8",
  champagne: "#E4D2AC",
  muted: "#A7A196",
  faint: "#6F6A61",
};
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const caps = (size: number, color: string, spacing: number, weight = 600) =>
  `font-family:${SANS};font-size:${size}px;line-height:1.5;font-weight:${weight};letter-spacing:${spacing}em;text-transform:uppercase;color:${color}`;
const rule = (width: number, color: string, margin = "0 auto") =>
  `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:${margin}"><tr><td width="${width}" height="1" bgcolor="${color}" style="width:${width}px;height:1px;font-size:0;line-height:0;background:${color}">&nbsp;</td></tr></table>`;

function properName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function accessLabel(capacity: number): string {
  return capacity === 1 ? "1 Guest" : `Up to ${capacity} Guests`;
}

function fact(label: string, value: string, serif = false) {
  const valueStyle = serif
    ? `font-family:${SERIF};font-size:22px;line-height:1.2;font-weight:500;color:${C.ivory}`
    : `font-family:${SANS};font-size:14px;line-height:1.45;font-weight:500;letter-spacing:0.02em;color:${C.ivory}`;
  return `<div style="${caps(9, C.gold, 0.32)}">${esc(label)}</div>
          <div style="margin-top:6px;${valueStyle}">${value}</div>`;
}

function partnerRow(partners: VipEmailInput["partners"]): string {
  if (!partners.length) return "";
  const width = Math.floor(100 / partners.length);
  const tiles = partners
    .map((partner) => {
      const box = partnerBox(partner.width, partner.height, { area: 3600, maxWidth: 124, maxHeight: 50 });
      return `<td width="${width}%" align="center" valign="middle" style="width:${width}%;padding:0 5px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${C.hair}"><tr>
          <td height="72" align="center" valign="middle" bgcolor="#FFFFFF" style="height:72px;padding:0 8px;background:#FFFFFF">
            <img src="${esc(partner.logoUrl)}" width="${box.width}" height="${box.height}" alt="${esc(partner.name)}" style="display:block;margin:0 auto;width:${box.width}px;max-width:100%;height:auto;border:0;outline:none">
          </td>
        </tr></table>
      </td>`;
    })
    .join("");
  return `<tr><td class="vip-px" style="padding:48px 44px 0">
      ${rule(512, C.hair, "0")}
      <div style="margin-top:26px;text-align:center;${caps(9, C.gold, 0.42)}">Official Partners</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;table-layout:fixed"><tr>${tiles}</tr></table>
    </td></tr>`;
}

export function renderVipEmail(input: VipEmailInput): { subject: string; html: string; text: string } {
  const host = properName(input.hostName);
  const first = host.split(" ")[0];
  const e = input.event;
  const contact = input.contactEmail ?? "contact@theonemorecompany.com";
  const subject = `Your private VIP invitation — ${e.title}`;
  const venue = [e.venue, e.city].filter(Boolean).join(", ");
  const venueValue = e.mapUrl
    ? `<a href="${esc(e.mapUrl)}" style="color:${C.ivory};text-decoration:none">${esc(e.venue)}</a>${e.city ? `<br><span style="color:${C.muted}">${esc(e.city)}</span>` : ""}`
    : `${esc(e.venue)}${e.city ? `<br><span style="color:${C.muted}">${esc(e.city)}</span>` : ""}`;
  const age = e.minAge ? `${e.minAge}+ Only` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&amp;family=Manrope:wght@500;600&amp;display=swap" rel="stylesheet">
<style>
  body{margin:0!important;padding:0!important;background:${C.page}}
  a{text-decoration:none}
  @media (max-width:620px){
    .vip-shell{padding:0!important}
    .vip-card{border-left:0!important;border-right:0!important}
    .vip-px{padding-left:22px!important;padding-right:22px!important}
    .vip-top{padding-top:40px!important}
    .vip-title{font-size:32px!important;line-height:36px!important}
    .vip-qr{width:172px!important;height:172px!important}
    .vip-btn a{padding:16px 26px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">Your table is reserved — ${esc(e.title)}, ${esc(e.date)}.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" class="vip-shell" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.stock}" class="vip-card" style="max-width:600px;background:${C.stock};border:1px solid ${C.hair}">
  <tr><td height="1" bgcolor="${C.goldDim}" style="height:1px;font-size:0;line-height:0;background:${C.goldDim}">&nbsp;</td></tr>

  <tr><td align="center" class="vip-px vip-top" style="padding:52px 44px 0">
    <img src="${esc(input.sealUrl)}" width="40" height="40" alt="The One More Company" style="display:block;margin:0 auto;width:40px;height:40px;border:0">
    <div style="margin-top:18px;${caps(10, C.gold, 0.42)}">The One More Company</div>
    ${rule(32, C.gold, "24px auto 0")}
    <div class="vip-title" style="margin-top:24px;font-family:${SERIF};font-size:40px;line-height:44px;font-weight:500;color:${C.ivory}">Private VIP Invitation</div>
    <div style="margin-top:14px;${caps(11, C.champagne, 0.34)}">${esc(e.title)}</div>
  </td></tr>

  <tr><td align="center" class="vip-px" style="padding:44px 44px 0">
    <div style="font-family:${SERIF};font-size:24px;line-height:1.2;font-style:italic;font-weight:500;color:${C.champagne}">${esc(first)},</div>
    <div style="margin-top:12px;${caps(12, C.ivory, 0.3)}">Your table is reserved.</div>
    <div style="margin:18px auto 0;max-width:400px;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.muted}">You are invited to join us for ${esc(e.title)} as a VIP guest of The One More Company.</div>
  </td></tr>

  <tr><td class="vip-px" style="padding:40px 44px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.hair}">
      <tr>
        <td width="50%" valign="top" style="width:50%;padding:20px 12px 20px 0;border-bottom:1px solid ${C.hair}">${fact("VIP Table", esc(input.table), true)}</td>
        <td width="50%" valign="top" style="width:50%;padding:20px 0 20px 12px;border-bottom:1px solid ${C.hair}">${fact("Access", esc(accessLabel(input.capacity)), true)}</td>
      </tr>
      <tr>
        <td valign="top" style="padding:20px 12px 20px 0;border-bottom:1px solid ${C.hair}">${fact("Date", esc(e.date))}</td>
        <td valign="top" style="padding:20px 0 20px 12px;border-bottom:1px solid ${C.hair}">${fact("Time", esc(e.time))}</td>
      </tr>
      <tr>
        <td valign="top" style="padding:20px 12px 20px 0;border-bottom:1px solid ${C.hair}">${fact("Venue", venueValue)}</td>
        <td valign="top" style="padding:20px 0 20px 12px;border-bottom:1px solid ${C.hair}">${age ? fact("Age", esc(age)) : "&nbsp;"}</td>
      </tr>
    </table>
  </td></tr>

  <tr><td align="center" class="vip-px" style="padding:36px 44px 0">
    <div style="${caps(10, C.ivory, 0.22, 500)}">This invitation provides VIP access for your group.</div>
    <div style="margin-top:6px;${caps(10, C.muted, 0.22, 500)}">Present the VIP pass below upon arrival.</div>
  </td></tr>

  <tr><td align="center" class="vip-px" style="padding:30px 44px 0">
    <div style="${caps(10, C.gold, 0.42)}">VIP Access</div>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" bgcolor="${C.ivory}" style="margin:14px auto 0;background:${C.ivory}"><tr>
      <td bgcolor="${C.ivory}" style="padding:14px;background:${C.ivory}"><img class="vip-qr" src="${esc(input.qrSrc)}" width="188" height="188" alt="VIP access code ${esc(input.code)}" style="display:block;width:188px;height:188px;border:0;image-rendering:pixelated"></td>
    </tr></table>
    <div style="margin-top:18px;font-family:${SANS};font-size:15px;line-height:1;font-weight:600;letter-spacing:0.3em;color:${C.ivory}">${esc(input.code)}</div>
    <div style="margin-top:9px;${caps(9, C.faint, 0.36)}">Private Table Credential</div>
  </td></tr>

  <tr><td align="center" class="vip-px vip-btn" style="padding:34px 44px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
      <td bgcolor="${C.gold}" style="background:${C.gold}">
        <a href="${esc(input.passUrl)}" style="display:inline-block;padding:16px 36px;${caps(11, C.stock, 0.26)};text-decoration:none">Open Your VIP Pass</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td align="center" class="vip-px" style="padding:30px 44px 0">
    <div style="margin:0 auto;max-width:400px;font-family:${SANS};font-size:13px;line-height:1.65;color:${C.muted}">If your group arrives separately, the same pass remains valid until all allocated admissions have been used.</div>
    <div style="margin-top:14px;${caps(9, C.faint, 0.3)}">${age ? `${esc(age)} &middot; ` : ""}Valid photo ID required</div>
    ${e.address ? `<div style="margin-top:6px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.faint}">${esc(e.address)}</div>` : ""}
  </td></tr>

  ${partnerRow(input.partners)}

  <tr><td align="center" class="vip-px" style="padding:48px 44px 48px">
    ${rule(24, C.goldDim)}
    <div style="margin-top:22px;${caps(9, C.faint, 0.4)}">The One More Company</div>
    <div style="margin-top:6px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.faint}">This invitation is personal to you and your guests.</div>
    <div style="margin-top:2px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.faint}"><a href="mailto:${esc(contact)}" style="color:${C.goldDim};text-decoration:none">${esc(contact)}</a></div>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;

  const text = [
    "THE ONE MORE COMPANY",
    "PRIVATE VIP INVITATION",
    "",
    `${first},`,
    "YOUR TABLE IS RESERVED.",
    `You are invited to join us for ${e.title} as a VIP guest of The One More Company.`,
    "",
    `VIP TABLE: ${input.table}`,
    `ACCESS: ${accessLabel(input.capacity).toUpperCase()}`,
    `DATE: ${e.date}`,
    `TIME: ${e.time}`,
    `VENUE: ${venue}`,
    ...(age ? [`AGE: ${age.toUpperCase()}`] : []),
    "",
    "This invitation provides VIP access for your group. Present your VIP pass upon arrival.",
    `Open your VIP pass: ${input.passUrl}`,
    `Credential: ${input.code}`,
    "",
    "If your group arrives separately, the same pass remains valid until all allocated admissions have been used.",
    "",
    ...(input.partners.length ? [`Official partners: ${input.partners.map((p) => p.name).join(", ")}`, ""] : []),
    "This invitation is personal to you and your guests.",
    contact,
  ].join("\n");

  return { subject, html, text };
}
