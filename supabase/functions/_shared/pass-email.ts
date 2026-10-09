/**
 * The ticket email, designed as an event pass: black stock, gold hairlines,
 * serif type, one ivory QR panel per guest. Table layout + inline styles only,
 * so it holds together in Gmail, Apple Mail and Outlook.
 */

export interface PassEmail {
  name: string | null;
  eventName: string;
  chapter?: string;
  dateLabel: string;
  timeLabel: string;
  venueName: string;
  venueAddress: string;
  mapUrl?: string;
  minimumAge?: number;
  tierName: string;
  /** One short paragraph on the evening itself. */
  invitation?: string;
  /** Named partner, printed large. */
  partner?: string;
  /** The plain fact under the partner name. */
  notice?: string;
  /** Brand marks at the foot of the pass. `logo` is an absolute image URL. */
  partners?: { name: string; logo: string; width: number; height: number; note?: string }[];
  heroUrl?: string;
  sealUrl: string;
  ticketsUrl: string;
  passes: { guest_number: number; token: string; qrSrc: string }[];
  /** Inbox the pass is sent to. Used for the greeting when no name was given. */
  to?: string;
}

const C = {
  page: "#0A0A09",
  stock: "#0F100F",
  card: "#131311",
  gold: "#BB9B63",
  goldDim: "#5C4E36",
  hair: "#2A2722",
  ivory: "#ECEAE4",
  muted: "#9A978C",
  faint: "#5F5D56",
  qr: "#F4F1EA",
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pad2 = (n: number) => String(n).padStart(2, "0");
const caps = (size: number, color: string, spacing = 0.32) =>
  `font:600 ${size}px/1.4 ${SANS};letter-spacing:${spacing}em;text-transform:uppercase;color:${color}`;

/** One code per row, so a couple pass scans top, then bottom. */
function qrRows(passes: PassEmail["passes"], total: number) {
  const size = total > 1 ? 108 : 150;
  return passes
    .map((p, i) => {
      const ref = p.token.slice(-6).toUpperCase();
      const rule =
        i > 0
          ? `<div style="margin:4px 28px 0;border-top:1px dashed ${C.goldDim};line-height:0;font-size:0">&nbsp;</div>`
          : "";
      return `<tr><td align="center" style="padding:0">
        ${rule}
        <div style="margin-top:4px;${caps(8, C.gold, 0.26)}">${pad2(p.guest_number)} / ${pad2(total)}${total > 1 ? ` &nbsp;&middot;&nbsp; <span style="font:400 10px/1 ${MONO};letter-spacing:0.22em">N&ordm; ${ref}</span>` : ""}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="${C.qr}" style="margin-top:4px;background:${C.qr};border:1px solid ${C.gold}"><tr>
          <td bgcolor="${C.qr}" style="padding:4px;background:${C.qr}"><img src="${p.qrSrc}" width="${size}" height="${size}" alt="Pass ${p.guest_number} QR code" style="display:block;width:${size}px;height:${size}px;border:0"></td>
        </tr></table>
        ${total === 1 ? `<div style="margin-top:4px;font:400 10px/1 ${MONO};letter-spacing:0.28em;color:${C.gold}">N&ordm; ${ref}</div>` : ""}
      </td></tr>`;
    })
    .join("");
}

/** "vinay kumar" / "VINAY KUMAR" → "Vinay Kumar"; mixed case (e.g. "McKay") is left alone. */
function properName(name: string | null): string | null {
  if (!name?.trim()) return null;
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** First readable word of a mailbox, when the booking has no name. "vivekankireddy95" → "Vivekankireddy". */
function nameFromEmail(email: string | undefined): string | null {
  const local = email?.split("@")[0]?.split("+")[0] ?? "";
  const word = local
    .split(/[._-]/)
    .map((part) => part.replace(/\d/g, ""))
    .find((part) => /^[a-z]{2,24}$/i.test(part));
  if (!word) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function fitBox(p: { width: number; height: number }, maxW: number, maxH: number) {
  const scale = Math.min(maxW / p.width, maxH / p.height);
  return { w: Math.max(1, Math.round(p.width * scale)), h: Math.max(1, Math.round(p.height * scale)) };
}

/** Lead mark the same width as the QR, centered on it. The others share one even row of that same width. */
function partnerFoot(partners: PassEmail["partners"]): string {
  if (!partners?.length) return "";
  const [lead, ...rest] = partners;
  const leadSize = fitBox(lead, 150, 120);
  const rowW = leadSize.w;
  const gap = 4;
  const smallW = rest.length ? Math.floor((rowW - gap * (rest.length - 1)) / rest.length) : 0;
  const smallH = 22;
  const small = rest
    .map((p) => {
      const size = fitBox(p, smallW - 6, smallH - 4);
      return `<td width="${smallW}" height="${smallH}" align="center" valign="middle" bgcolor="#ffffff" style="width:${smallW}px;height:${smallH}px;background:#ffffff"><img src="${esc(p.logo)}" width="${size.w}" height="${size.h}" alt="${esc(p.name)}" style="display:block;width:${size.w}px;height:${size.h}px;border:0"></td>`;
    })
    .join(`<td width="${gap}" bgcolor="${C.stock}" style="width:${gap}px;font-size:0;line-height:0;background:${C.stock}">&nbsp;</td>`);
  const note = partners.find((p) => p.note)?.note;
  return `<tr><td align="center" bgcolor="${C.stock}" style="padding:7px 8px 0;background:${C.stock}">
    <div style="${caps(7, C.gold, 0.36)}">Partners</div>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" width="${rowW}" style="margin-top:5px;width:${rowW}px"><tr>
      <td align="center" valign="middle" bgcolor="#ffffff" width="${rowW}" style="width:${rowW}px;background:#ffffff"><img src="${esc(lead.logo)}" width="${leadSize.w}" height="${leadSize.h}" alt="${esc(lead.name)}" style="display:block;width:${leadSize.w}px;height:${leadSize.h}px;border:0"></td>
    </tr></table>
    ${
      rest.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" width="${rowW}" style="margin-top:4px;width:${rowW}px"><tr>${small}</tr></table>`
        : ""
    }
    ${note ? `<div style="margin-top:5px;font:500 10px/1.3 ${SANS};color:${C.ivory}">${esc(note)}</div>` : ""}
  </td></tr>`;
}

export function renderPassEmail(input: PassEmail): { subject: string; html: string; text: string } {
  const named = properName(input.name);
  const first = named?.split(" ")[0] ?? nameFromEmail(input.to);
  const d = { ...input, name: named ?? first };
  const total = d.passes.length;
  const venue = d.mapUrl
    ? `<a href="${d.mapUrl}" style="color:${C.ivory};text-decoration:none">${esc(d.venueName)}</a>`
    : esc(d.venueName);
  const door = `${d.minimumAge ? `${d.minimumAge}+ · photo ID · ` : ""}scanned once`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(d.eventName)} — your passes</title></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(d.eventName)} &middot; ${esc(d.dateLabel)} &middot; ${total} ${total === 1 ? "pass" : "passes"} inside.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" bgcolor="${C.page}" style="padding:6px 6px 10px;background:${C.page}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.stock}" style="max-width:420px;background:${C.stock};border:1px solid ${C.gold}">

    <tr><td align="center" bgcolor="${C.stock}" style="padding:8px 8px 0;background:${C.stock}">
      <img src="${d.sealUrl}" width="22" height="22" alt="The One More Company" style="display:block;width:22px;height:22px;border:0">
      <div style="margin-top:3px;${caps(7, C.gold, 0.42)}">The One More Company</div>
      <div style="margin:5px auto 0;width:28px;border-top:1px solid ${C.gold};line-height:0;font-size:0">&nbsp;</div>
      ${first ? `<div style="margin-top:5px;font:italic 400 16px/1 ${SERIF};color:#D8C196;white-space:nowrap">Dear ${esc(first)},</div>` : ""}
      <div style="margin-top:2px;font:400 24px/1 ${SERIF};color:${C.ivory};white-space:nowrap">${esc(d.eventName)}</div>
      <div style="margin-top:3px;font:400 11px/1.25 ${SANS};color:${C.ivory};white-space:nowrap">${esc(d.dateLabel)} &middot; ${esc(d.timeLabel)}</div>
      <div style="font:400 11px/1.3 ${SANS};color:${C.muted};white-space:nowrap">${venue}</div>
      ${d.invitation ? `<div style="margin-top:4px;font:italic 400 11px/1.2 ${SERIF};color:${C.ivory};white-space:nowrap">${esc(d.invitation)}</div>` : ""}
    </td></tr>

    <tr><td bgcolor="${C.stock}" style="padding:6px 10px 0;background:${C.stock}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.gold}" style="background:${C.gold}"><tr><td bgcolor="${C.gold}" style="padding:1px;background:${C.gold}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.card}" style="background:${C.card}"><tr><td align="center" bgcolor="${C.card}" style="padding:8px 6px 8px;background:${C.card}">
          <div style="${caps(8, C.gold, 0.28)}">Admit one &middot; ${esc(d.tierName)}</div>
          ${d.name ? `<div style="margin-top:2px;font:italic 400 17px/1.1 ${SERIF};color:${C.ivory};white-space:nowrap">${esc(d.name)}</div>` : ""}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${qrRows(d.passes, total)}
          </table>
          ${
            total === 1
              ? `<div style="margin:7px 8px 0;border-top:1px dashed ${C.goldDim};line-height:0;font-size:0">&nbsp;</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px"><tr>
            <td style="${caps(7, C.muted, 0.1)};white-space:nowrap">${esc(d.dateLabel)}</td>
            <td align="right" style="${caps(7, C.muted, 0.1)};white-space:nowrap">${esc(d.venueName)}</td>
          </tr></table>`
              : ""
          }
        </td></tr></table>
      </td></tr></table>
    </td></tr>

    ${partnerFoot(d.partners)}

    <tr><td align="center" bgcolor="${C.stock}" style="padding:6px 8px 8px;background:${C.stock};font:400 10px/1.3 ${SANS};color:${C.muted};white-space:nowrap">
      ${door} &middot; <a href="${d.ticketsUrl}" style="color:${C.gold};text-decoration:none">View passes</a>
      <div style="margin-top:3px;font:400 9px/1.3 ${SANS};color:${C.muted}">Non-refundable unless the event is cancelled &middot; <a href="https://theonemorecompany.com/refunds/" style="color:${C.muted}">Policy</a></div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;

  const text = [
    first ? `Dear ${first},` : `${d.eventName} — ${total === 1 ? "pass" : "passes"} confirmed`,
    "",
    `${d.dateLabel} · ${d.timeLabel}`,
    `${d.venueName}, ${d.venueAddress}`,
    `${d.tierName} · ${total} ${total === 1 ? "guest" : "guests"}`,
    "",
    ...(d.invitation ? [d.invitation, ""] : []),
    ...(d.partners?.length ? [`Partners: ${d.partners.map((p) => p.name).join(", ")}`, ""] : []),
    ...(d.partner && !d.partners?.length ? [`Food partner: ${d.partner}`] : []),
    ...(d.notice ? [d.notice, ""] : []),
    `Your passes: ${d.ticketsUrl}`,
    "",
    "One pass per guest. Each pass is scanned once — keep them private.",
    "Tickets are non-refundable unless the event is cancelled: https://theonemorecompany.com/refunds/",
  ].join("\n");

  const subject = first
    ? `${first}, your passes — ${d.eventName}, ${d.dateLabel}`
    : `Your passes — ${d.eventName}, ${d.dateLabel}`;
  return { subject, html, text };
}
