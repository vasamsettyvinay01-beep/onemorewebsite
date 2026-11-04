/**
 * Complimentary invitation. One email, one unique QR per guest. No money language.
 */
import { partnerBox } from "./vip.mjs";
import type { VipEmailEvent } from "./vip-email.ts";

export interface ComplimentaryEmailInput {
  hostName: string;
  count: number;
  event: VipEmailEvent;
  sealUrl: string;
  passes: { number: number; qrSrc: string }[];
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
};
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const caps = (size: number, color: string, spacing: number) =>
  `font-family:${SANS};font-size:${size}px;line-height:1.5;font-weight:600;letter-spacing:${spacing}em;text-transform:uppercase;color:${color}`;

function properName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function admissionsLabel(count: number): string {
  return count === 1 ? "1 Admission Reserved" : `${count} Admissions Reserved`;
}

export function renderComplimentaryEmail(input: ComplimentaryEmailInput): { subject: string; html: string; text: string } {
  const host = properName(input.hostName);
  const first = host.split(" ")[0];
  const e = input.event;
  const contact = input.contactEmail ?? "contact@theonemorecompany.com";
  const subject = `Your complimentary invitation — ${e.title}`;
  const venue = [e.venue, e.city].filter(Boolean).join(", ");
  const passes = input.passes
    .map((pass) => `<tr><td align="center" class="comp-px" style="padding:28px 44px 0">
      <div style="${caps(11, C.gold, 0.34)}">Pass ${pass.number}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="${C.ivory}" style="margin-top:14px;background:${C.ivory}"><tr>
        <td style="padding:16px;background:${C.ivory}"><img class="comp-qr" src="${esc(pass.qrSrc)}" width="196" height="196" alt="Pass ${pass.number}" style="display:block;width:196px;height:196px;border:0"></td>
      </tr></table>
      <div style="margin-top:10px;${caps(9, C.muted, 0.28)}">Admits 1 guest</div>
    </td></tr>`)
    .join("");
  const width = input.partners.length ? Math.floor(100 / input.partners.length) : 100;
  const partnerTiles = input.partners
    .map((partner) => {
      const box = partnerBox(partner.width, partner.height, { area: 3600, maxWidth: 124, maxHeight: 50 });
      return `<td width="${width}%" align="center" valign="middle" style="width:${width}%;padding:0 5px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${C.hair}"><tr>
          <td height="72" align="center" valign="middle" bgcolor="#FFFFFF" style="height:72px;padding:0 8px;background:#FFFFFF">
            <img src="${esc(partner.logoUrl)}" width="${box.width}" height="${box.height}" alt="${esc(partner.name)}" style="display:block;margin:0 auto;width:${box.width}px;max-width:100%;height:auto;border:0">
          </td>
        </tr></table>
      </td>`;
    })
    .join("");
  const age = e.minAge ? `${e.minAge}+` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<title>${esc(subject)}</title>
<style>
  body{margin:0!important;padding:0!important;background:${C.page}}
  a{text-decoration:none}
  @media (max-width:620px){
    .comp-px{padding-left:22px!important;padding-right:22px!important}
    .comp-title{font-size:32px!important;line-height:36px!important}
    .comp-qr{width:168px!important;height:168px!important}
  }
</style></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.stock}" style="max-width:600px;background:${C.stock};border:1px solid ${C.hair}">
  <tr><td height="1" bgcolor="${C.goldDim}" style="height:1px;font-size:0;line-height:0;background:${C.goldDim}">&nbsp;</td></tr>
  <tr><td align="center" class="comp-px" style="padding:52px 44px 0">
    <img src="${esc(input.sealUrl)}" width="40" height="40" alt="The One More Company" style="display:block;margin:0 auto;width:40px;height:40px;border:0">
    <div style="margin-top:18px;${caps(10, C.gold, 0.42)}">The One More Company</div>
    <div class="comp-title" style="margin-top:28px;font-family:${SERIF};font-size:40px;line-height:44px;font-weight:500;color:${C.ivory}">Your Complimentary Invitation</div>
    <div style="margin-top:14px;${caps(11, C.champagne, 0.34)}">${esc(e.title)}</div>
  </td></tr>
  <tr><td align="center" class="comp-px" style="padding:36px 44px 0">
    <div style="font-family:${SERIF};font-size:24px;line-height:1.2;font-style:italic;color:${C.champagne}">${esc(first)},</div>
    <div style="margin-top:16px;max-width:420px;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.muted}">We've reserved ${input.count === 1 ? "1 admission" : `${input.count} admissions`} for you for ${esc(e.title)}.</div>
    <div style="margin-top:12px;max-width:420px;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.muted}">Each pass below admits one guest and can be presented separately at the door.</div>
  </td></tr>
  <tr><td align="center" class="comp-px" style="padding:32px 44px 0">
    <div style="${caps(12, C.ivory, 0.28)}">${esc(admissionsLabel(input.count))}</div>
    <div style="margin-top:18px;font-family:${SANS};font-size:14px;line-height:1.7;color:${C.ivory}">
      ${esc(e.date)}<br>${esc(e.time)}<br>${esc(e.venue)}<br>${esc(e.city)}${age ? `<br>${esc(age)}` : ""}
    </div>
  </td></tr>
  ${passes}
  ${input.partners.length ? `<tr><td class="comp-px" style="padding:40px 44px 0">
    <div style="text-align:center;${caps(9, C.gold, 0.42)}">Official Partners</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;table-layout:fixed"><tr>${partnerTiles}</tr></table>
  </td></tr>` : ""}
  <tr><td align="center" class="comp-px" style="padding:36px 44px 40px">
    <div style="${caps(9, C.gold, 0.36)}">The One More Company</div>
    <div style="margin-top:8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted}">This invitation is personal to you.<br><a href="mailto:${esc(contact)}" style="color:${C.champagne}">${esc(contact)}</a></div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    "THE ONE MORE COMPANY",
    "Your complimentary invitation",
    e.title,
    "",
    `${first},`,
    `We've reserved ${input.count === 1 ? "1 admission" : `${input.count} admissions`} for you for ${e.title}.`,
    "Each pass admits one guest and can be presented separately at the door.",
    "",
    admissionsLabel(input.count),
    [e.date, e.time, venue, age].filter(Boolean).join("\n"),
    "",
    ...input.passes.map((pass) => `Pass ${pass.number} — admits 1 guest`),
    "",
    input.partners.length ? `Official partners: ${input.partners.map((partner) => partner.name).join(", ")}` : "",
    "",
    `The One More Company · ${contact}`,
  ].filter((line) => line !== undefined).join("\n");
  return { subject, html, text };
}
