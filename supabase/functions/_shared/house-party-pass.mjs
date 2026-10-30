export const arrivalHref = "https://share.google/vOEHkG0M4rXfogmJm";
export const arrivalName = "Broadstone Amelia";
export const arrivalPlace = "1610 Campbell Rd, Houston, TX";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function peopleLabel(count) {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

export function renderHousePartyEmail(input) {
  const guests = (input.guestNames ?? []).filter(Boolean);
  const guestLine = guests.length ? guests.map(esc).join(", ") : "Just you";
  const subject = "YOU'RE IN — Diwali × Halloween House Party 🎃🪔";
  const text = [
    "THE ONE MORE COMPANY",
    "",
    "YOU'RE IN.",
    "",
    "Your FREE RSVP for the DIWALI × HALLOWEEN HOUSE PARTY is confirmed.",
    "",
    `RSVP FOR: ${peopleLabel(input.partySize).toUpperCase()}`,
    `RSVP NAME: ${input.fullName}`,
    `ADDITIONAL GUESTS: ${guests.join(", ") || "None"}`,
    `PASS CODE: ${input.code}`,
    "",
    "TONIGHT · OCT 30",
    "9 PM ONWARDS",
    "21+ ONLY",
    "",
    "FREE ENTRY",
    "NO COVER",
    "NO PAYMENT REQUIRED",
    "",
    `ARRIVAL: ${arrivalName}`,
    arrivalPlace,
    arrivalHref,
    "ARRIVE AT THE SHARED LOCATION.",
    "ONCE YOU GET THERE, CONTACT US AND WE'LL GUIDE YOU TO THE HOUSE.",
    "",
    "BYOB — BRING YOUR OWN DRINKS.",
    "THE ONE MORE COMPANY IS NOT SELLING ALCOHOL AT THIS PRIVATE HOUSE PARTY.",
    "NO ALCOHOL IS AVAILABLE FOR PURCHASE FROM THE HOST.",
    "21+ ONLY.",
    "BRING A VALID GOVERNMENT-ISSUED PHOTO ID.",
    "",
    "BEFORE YOU COME",
    "Your House Party Pass",
    "Valid 21+ photo ID",
    "Your own drinks if you'd like — BYOB",
    "Your Diwali × Halloween fit",
    "Good energy",
    "DESI × SPOOKY × GLAM",
    "",
    "PRIVATE HOUSE PARTY",
    "FREE ENTRY · RSVP REQUIRED",
    "STRICT 30-PERSON CAPACITY",
    "ONLY CONFIRMED GUESTS MAY ATTEND.",
    "PLEASE DO NOT BRING ADDITIONAL GUESTS WHO ARE NOT INCLUDED IN YOUR RSVP.",
    "",
    `Your pass: ${input.passUrl}`,
    "",
    "TONIGHT IS THE TRAILER.",
    "NOVEMBER 7 IS THE MAIN EVENT.",
    "INDIAN DIWALI NIGHT",
    "NOV 7 · THE NICHOLS VENUE · HOUSTON",
    input.nov7Url,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#0f0f10;color:#f6f1e8;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f10;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #c6a15b;background:#141011;">
        <tr><td style="padding:28px 24px 8px;text-align:center;">
          <img src="${esc(input.sealUrl)}" width="72" height="72" alt="The One More Company" style="display:block;margin:0 auto 16px;border:0;">
          <p style="margin:0;letter-spacing:.16em;font-size:11px;color:#df8a42;">THE ONE MORE COMPANY</p>
          <h1 style="margin:14px 0 0;font-size:42px;line-height:.95;letter-spacing:-.04em;text-transform:uppercase;">You're in. 🔥</h1>
          <p style="margin:16px 0 0;font-size:16px;line-height:1.5;color:#f6f1e8;">Your FREE RSVP for the<br><strong>DIWALI × HALLOWEEN HOUSE PARTY</strong><br>is confirmed.</p>
        </td></tr>
        <tr><td style="padding:8px 24px 0;text-align:center;">
          <p style="margin:18px 0 0;letter-spacing:.14em;font-size:12px;color:#c6a15b;">RSVP FOR</p>
          <p style="margin:6px 0 0;font-size:32px;letter-spacing:-.04em;text-transform:uppercase;">${esc(peopleLabel(input.partySize))}</p>
          <p style="margin:16px 0 0;font-size:14px;line-height:1.6;">${esc(input.fullName)}<br>${guestLine}</p>
          <p style="margin:16px 0 0;letter-spacing:.14em;font-size:12px;">PASS CODE ${esc(input.code)}</p>
          <img src="cid:house-party-pass" width="168" height="168" alt="" style="display:block;margin:16px auto;background:#f6f1e8;padding:8px;">
          <p style="margin:0;font-size:13px;letter-spacing:.12em;">TONIGHT · OCT 30<br>9 PM ONWARDS<br>21+ ONLY</p>
          <p style="margin:18px 0 0;font-size:18px;letter-spacing:.12em;color:#c6a15b;">FREE ENTRY<br>NO COVER<br>NO PAYMENT REQUIRED</p>
        </td></tr>
        <tr><td style="padding:22px 24px 0;font-size:14px;line-height:1.6;">
          <p style="margin:0;letter-spacing:.14em;font-size:12px;color:#c6a15b;">ARRIVAL</p>
          <p style="margin:8px 0 0;">${esc(arrivalName)}<br>${esc(arrivalPlace)}</p>
          <p style="margin:12px 0;"><a href="${esc(arrivalHref)}" style="display:inline-block;background:#c6a15b;color:#0f0f10;text-decoration:none;letter-spacing:.12em;font-size:12px;padding:12px 16px;">OPEN ARRIVAL LOCATION</a></p>
          <p style="margin:0;">ARRIVE AT THE SHARED LOCATION.<br>ONCE YOU GET THERE, CONTACT US AND WE'LL GUIDE YOU TO THE HOUSE.</p>
        </td></tr>
        <tr><td style="padding:22px 24px 0;font-size:14px;line-height:1.6;">
          <p style="margin:0;">BYOB — BRING YOUR OWN DRINKS.</p>
          <p style="margin:8px 0 0;">THE ONE MORE COMPANY IS NOT SELLING ALCOHOL AT THIS PRIVATE HOUSE PARTY.</p>
          <p style="margin:8px 0 0;">NO ALCOHOL IS AVAILABLE FOR PURCHASE FROM THE HOST.</p>
          <p style="margin:8px 0 0;">21+ ONLY. BRING A VALID GOVERNMENT-ISSUED PHOTO ID.</p>
          <p style="margin:14px 0 0;">SNACKS &amp; SODAS ON US · MUSIC · GAMES · GOOD VIBES</p>
        </td></tr>
        <tr><td style="padding:22px 24px 0;font-size:14px;line-height:1.7;">
          <p style="margin:0;letter-spacing:.14em;font-size:12px;color:#c6a15b;">BEFORE YOU COME</p>
          <p style="margin:8px 0 0;">✓ Your House Party Pass<br>✓ Valid 21+ photo ID<br>✓ Your own drinks if you'd like — BYOB<br>✓ Your Diwali × Halloween fit<br>✓ Good energy</p>
          <p style="margin:12px 0 0;">DESI × SPOOKY × GLAM<br>Go Desi. Go Spooky. Or mix both.</p>
        </td></tr>
        <tr><td style="padding:22px 24px 0;font-size:14px;line-height:1.6;">
          <p style="margin:0;">PRIVATE HOUSE PARTY<br>FREE ENTRY · RSVP REQUIRED<br>STRICT 30-PERSON CAPACITY</p>
          <p style="margin:8px 0 0;">ONLY CONFIRMED GUESTS MAY ATTEND.<br>PLEASE DO NOT BRING ADDITIONAL GUESTS WHO ARE NOT INCLUDED IN YOUR RSVP.</p>
          <p style="margin:14px 0 0;"><a href="${esc(input.passUrl)}" style="color:#c6a15b;">View your House Party Pass</a></p>
        </td></tr>
        <tr><td style="padding:28px 24px 32px;text-align:center;">
          <p style="margin:0;font-size:20px;line-height:1.3;">Tonight is the trailer.<br>November 7 is the main event.</p>
          <p style="margin:14px 0 0;letter-spacing:.12em;font-size:12px;">INDIAN DIWALI NIGHT<br>NOV 7 · THE NICHOLS VENUE · HOUSTON</p>
          <p style="margin:16px 0 0;"><a href="${esc(input.nov7Url)}" style="display:inline-block;background:#c6a15b;color:#0f0f10;text-decoration:none;letter-spacing:.12em;font-size:12px;padding:12px 16px;">GET NOV 7 TICKETS</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

function partyCount(count) {
  const size = Number(count) || 0;
  return `${size} ${size === 1 ? "PERSON" : "PEOPLE"}`;
}

function organizerShell(title, rows, extra) {
  const body = rows
    .map(([label, value]) => `<tr><td style="padding:8px 0;color:#c6a15b;font-size:11px;letter-spacing:.12em;vertical-align:top;width:42%;">${esc(label)}</td><td style="padding:8px 0;color:#f6f1e8;font-size:14px;">${esc(value)}</td></tr>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#0f0f10;color:#f6f1e8;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f10;padding:28px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #c6a15b;background:#141011;">
      <tr><td style="padding:28px 24px 8px;">
        <p style="margin:0;letter-spacing:.16em;font-size:11px;color:#c6a15b;">THE ONE MORE COMPANY</p>
        <h1 style="margin:14px 0 0;font-size:28px;line-height:1;letter-spacing:-.03em;text-transform:uppercase;">${title}</h1>
        <p style="margin:12px 0 0;letter-spacing:.12em;font-size:12px;">DIWALI × HALLOWEEN HOUSE PARTY</p>
      </td></tr>
      <tr><td style="padding:8px 24px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>${extra || ""}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function renderHousePartyOrganizerEmail(input) {
  const guests = (input.guestNames ?? []).map((name) => String(name).trim()).filter(Boolean);
  const count = partyCount(input.partySize);
  const subject = `NEW HOUSE PARTY RSVP — ${count} — ${input.fullName}`;
  const rows = [
    ["STATUS", "CONFIRMED"],
    ["PRIMARY GUEST", input.fullName],
    ["PARTY SIZE", count],
    ["ADDITIONAL GUESTS", guests.length ? guests.join(", ") : "None"],
    ["EMAIL", input.email],
    ["PHONE", input.phone],
    ["INSTAGRAM", input.instagram || "Not provided"],
    ["AGE CONFIRMATION", "21+ confirmed"],
    ["RSVP TIME", input.rsvpTime],
    ["CONFIRMATION / PASS ID", input.code || "Pending"],
    ["CONFIRMED PEOPLE", `${input.confirmedPeople} / ${input.capacity}`],
    ["SPOTS REMAINING", String(input.spotsRemaining)],
  ];
  const text = ["THE ONE MORE COMPANY", "", "NEW HOUSE PARTY RSVP", "", ...rows.map(([label, value]) => `${label}: ${value}`), "", `OPEN HOUSE PARTY PAGE: ${input.pageUrl}`].join("\n");
  const extra = `<p style="margin:18px 0 0;"><a href="${esc(input.pageUrl)}" style="display:inline-block;background:#c6a15b;color:#0f0f10;text-decoration:none;letter-spacing:.12em;font-size:12px;padding:12px 16px;">OPEN HOUSE PARTY PAGE</a></p>`;
  return { subject, html: organizerShell("New House Party RSVP 🔥", rows, extra), text };
}

export function renderHousePartyCancellationEmail(input) {
  const subject = `HOUSE PARTY RSVP CANCELLED — ${input.fullName}`;
  const rows = [
    ["NAME", input.fullName],
    ["PARTY SIZE", partyCount(input.partySize)],
    ["CANCELLED AT", input.cancelledAt],
    ["UPDATED CONFIRMED PEOPLE", `${input.confirmedPeople} / ${input.capacity}`],
    ["UPDATED SPOTS REMAINING", String(input.spotsRemaining)],
  ];
  const text = ["THE ONE MORE COMPANY", "", subject, "", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  return { subject, html: organizerShell("House Party RSVP cancelled", rows), text };
}
