import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { events } from "../src/data/events.ts";
import { partnerBox as webPartnerBox } from "../src/lib/partner-box.ts";
import { renderVipEmail } from "../supabase/functions/_shared/vip-email.ts";
import {
  admitChoices,
  isVipToken,
  parseVipCapacity,
  parseVipCode,
  parseVipHostName,
  parseVipNote,
  parseVipPhone,
  parseVipTableLabel,
  partnerBox,
  publicVipPass,
  revokePhraseOk,
  VIP_CAPACITIES,
  VIP_FORBIDDEN_GUEST_TERMS,
  vipEventFromMetadata,
  vipPartnersFromMetadata,
  vipSummary,
} from "../supabase/functions/_shared/vip.mjs";
import { permit, requiresMfa, rateLimitFor } from "../supabase/functions/_shared/staff-auth.mjs";
import { isOpenMutation, isReadAction } from "../supabase/functions/_shared/admin-read.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20261105000000_vip_invitations.sql");
const adminFn = read("supabase/functions/admin/index.ts");
const doorFn = read("supabase/functions/door/index.ts");
const passFn = read("supabase/functions/vip-pass/index.ts");
const delivery = read("supabase/functions/_shared/vip-delivery.ts");
const doorPanel = read("src/components/door/VipDoorPanel.tsx");
const credential = read("src/components/vip/VipCredential.tsx");
const passView = read("src/components/vip/VipPassView.tsx");
const adminPanel = read("src/components/admin/VipPanel.tsx");
const config = read("supabase/config.toml");
const nextConfig = read("next.config.mjs");

// Current production metadata for Diwali Night (tiers.metadata), the partner source of truth.
const productionMeta = {
  omc_event_name: "Diwali Night",
  omc_event_date: "Saturday, November 7, 2026",
  omc_event_time: "9 PM – 2 AM",
  omc_venue_name: "The Nichols Venue",
  omc_venue_address: "2515 Morse St, Houston, TX 77019",
  omc_map_url: "https://www.google.com/maps/search/?api=1&query=The+Nichols+Venue+2515+Morse+St+Houston+TX+77019",
  omc_min_age: "21",
  omc_partners: JSON.stringify([
    { name: "Pista House", logo: "partners/pista-house.png", w: 819, h: 454, note: "Food and alcohol are for sale at the event, not included." },
    { name: "Pumpkin", logo: "partners/pumpkin.png", w: 1020, h: 432, note: "" },
    { name: "Dumont Creamery & Café", logo: "partners/dumont.png", w: 824, h: 232, note: "" },
  ]),
};
const vipEvent = vipEventFromMetadata("evt_diwali_night", productionMeta);
const partners = vipPartnersFromMetadata(productionMeta.omc_partners);
const token = `vip_${"a1".repeat(24)}`;

function renderSample(capacity = 6, overrides = {}) {
  return renderVipEmail({
    hostName: "arjun mehta",
    table: "VIP TABLE 04",
    capacity,
    event: vipEvent,
    code: "VIP-7K9M4Q",
    passUrl: `https://theonemorecompany.com/vip#${token}`,
    qrSrc: "cid:vip-access",
    sealUrl: "https://example.com/seal.png",
    partners: partners.map((partner) => ({ ...partner, logoUrl: `https://example.com/brand/${partner.logo}` })),
    ...overrides,
  });
}

/** Text a guest can see: body text, alt text, title. Tags, styles, and URLs removed. */
function visible(html) {
  const alts = [...html.matchAll(/alt="([^"]*)"/g)].map((match) => match[1]).join(" ");
  const body = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return `${body} ${alts}`;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|mjs|css|json)$/.test(name)) out.push(path);
  }
  return out;
}

test("1–2. a super admin can issue VIP for one guest and for six guests", () => {
  assert.deepEqual(VIP_CAPACITIES, [1, 2, 3, 4, 5, 6]);
  assert.equal(parseVipCapacity(1), 1);
  assert.equal(parseVipCapacity(6), 6);
  assert.equal(parseVipCapacity("6"), 6);
  assert.equal(permit("super_admin", "vip_issue"), true);
  assert.match(adminFn, /case "vip_issue":/);
  assert.match(adminFn, /admin\.rpc\("issue_vip_invitation"/);
});

test("3–4. capacity 7, 0, and non-integers are rejected in the browser, the server, and the database", () => {
  for (const bad of [0, 7, 8, 10, -1, 6.5, "7", "0", "six", "", null, undefined, "6; drop", [6], {}]) {
    assert.equal(parseVipCapacity(bad), null, `capacity ${JSON.stringify(bad)}`);
  }
  assert.match(adminFn, /parseVipCapacity\(body\.capacity\)/);
  assert.match(adminFn, /Access must be between 1 and 6 guests\./);
  assert.match(migration, /capacity int not null check \(capacity between 1 and 6\)/);
  assert.match(migration, /p_capacity < 1 or p_capacity > 6/);
  assert.match(migration, /constraint vip_invitations_admitted_within_capacity check \(admitted <= capacity\)/);
  assert.match(adminPanel, /const CAPACITIES = \[1, 2, 3, 4, 5, 6\] as const;/);
  assert.doesNotMatch(adminPanel, /type="number"/);
});

test("5–6. VIP never appears in public ticket data, public pages, or public APIs", () => {
  const diwali = events.find((event) => event.slug === "diwali-night");
  assert.ok(diwali);
  assert.equal(diwali.ticketTiers.some((tier) => /vip/i.test(`${tier.id} ${tier.name} ${tier.description ?? ""}`)), false);
  assert.equal(diwali.ticketTiers.some((tier) => tier.priceCents <= 0), false);

  const privateAreas = [/src[\\/]components[\\/]admin[\\/]/, /src[\\/]app[\\/]admin[\\/]/, /src[\\/]components[\\/]door[\\/]/, /src[\\/]components[\\/]vip[\\/]/, /src[\\/]app[\\/]vip[\\/]/, /src[\\/]lib[\\/]vip\.ts$/];
  const leaks = walk(join(root, "src"))
    .filter((path) => !privateAreas.some((pattern) => pattern.test(path)))
    .filter((path) => /\bvip\b/i.test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path));
  assert.deepEqual(leaks, []);

  for (const fn of ["availability", "checkout", "create-checkout-session", "stripe-webhook", "ticket-view", "ticket-share", "house-party"]) {
    assert.doesNotMatch(read(`supabase/functions/${fn}/index.ts`), /vip/i, fn);
  }
  for (const path of ["src/app/vip/page.tsx", "src/app/vip/layout.tsx"]) {
    assert.doesNotMatch(read(path), /\$\d|price|free|complimentary/i, path);
  }
});

test("7. the invitation email contains no price or transactional wording", () => {
  for (const capacity of VIP_CAPACITIES) {
    const email = renderSample(capacity);
    assert.doesNotMatch(visible(email.html), VIP_FORBIDDEN_GUEST_TERMS, `html capacity ${capacity}`);
    assert.doesNotMatch(email.text, VIP_FORBIDDEN_GUEST_TERMS, `text capacity ${capacity}`);
    assert.doesNotMatch(email.subject, VIP_FORBIDDEN_GUEST_TERMS);
    assert.doesNotMatch(email.html, /\$|View ticket|Download ticket|Order details/i);
  }
  const email = renderSample();
  assert.equal(email.subject, "Your private VIP invitation — Indian Diwali Night");
  assert.match(email.html, /Private VIP Invitation/);
  assert.match(email.html, /Your table is reserved\./);
  assert.match(email.html, /Arjun,/);
  assert.match(email.html, /VIP TABLE 04/);
  assert.match(email.html, /Up to 6 Guests/);
  assert.match(email.html, /November 7, 2026/);
  assert.match(email.html, /9 PM – 2 AM/);
  assert.match(email.html, /The Nichols Venue/);
  assert.match(email.html, /Houston/);
  assert.match(email.html, /21\+ Only/);
  assert.match(email.html, /Open Your VIP Pass/);
  assert.match(email.html, /If your group arrives separately, the same pass remains valid until all allocated admissions have been used\./);
  assert.match(renderSample(1).html, /1 Guest/);
});

test("7b. the admin note, phone, and email never reach the guest email", () => {
  assert.doesNotMatch(read("supabase/functions/_shared/vip-email.ts"), /\bnote\b|\bphone\b|admin_note/i);
  assert.match(delivery, /to: \[input\.to\]/);
  assert.doesNotMatch(delivery, /admin_note|note:/);
});

test("8. the pass page and credential contain no price language", () => {
  for (const [name, source] of [["credential", credential], ["view", passView]]) {
    const literals = source.replace(/\$\{/g, "{");
    assert.doesNotMatch(literals, VIP_FORBIDDEN_GUEST_TERMS, name);
  }
  assert.match(credential, /Private VIP Invitation/);
  assert.match(credential, /VIP Access Complete/);
  assert.match(credential, /Private Table Credential/);
});

test("9 & 33. the record exists before delivery, and a failed email stays resendable", () => {
  const issue = adminFn.slice(adminFn.indexOf("async function vipIssue"), adminFn.indexOf("async function vipResend"));
  assert.ok(issue.indexOf('admin.rpc("issue_vip_invitation"') < issue.indexOf("deliverVip(row"));
  assert.match(issue, /Use Resend from the list below\./);
  const deliver = adminFn.slice(adminFn.indexOf("async function deliverVip"), adminFn.indexOf("async function vipIssue"));
  assert.ok(deliver.indexOf("sendVipInvitationEmail") < deliver.indexOf("email_sent_at: new Date()"));
  assert.match(deliver, /return false;/);
  assert.match(deliver, /VIP_EMAIL_FAILED/);
  assert.match(delivery, /if \(!res\.ok\) throw/);
});

test("10. the email is built for phones: 600px stock, mobile padding, inline hierarchy", () => {
  const { html } = renderSample();
  assert.match(html, /max-width:600px/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media \(max-width:620px\)/);
  assert.match(html, /\.vip-px\{padding-left:22px!important;padding-right:22px!important\}/);
  assert.match(html, /padding:52px 44px 0/);
  assert.match(html, /role="presentation"/);
  assert.doesNotMatch(html, /display:\s*(flex|grid)/);
  assert.doesNotMatch(html, /<script/i);
});

test("11–12. all production partners appear, at equal visual weight, in email and on the pass", () => {
  assert.deepEqual(partners.map((partner) => partner.name), ["Pista House", "Pumpkin", "Dumont Creamery & Café"]);
  const { html, text } = renderSample();
  for (const partner of partners) {
    assert.match(html, new RegExp(`alt="${partner.name.replace("&", "&amp;")}"`));
    assert.match(html, new RegExp(partner.logo.replace(/[.]/g, "\\.")));
  }
  assert.match(html, /Official Partners/);
  assert.match(text, /Official partners: Pista House, Pumpkin, Dumont Creamery & Café/);
  assert.ok(html.indexOf("Official Partners") > html.indexOf("Open Your VIP Pass"), "partners sit below the pass, never beside the title");

  for (const options of [{ area: 3600, maxWidth: 124, maxHeight: 50 }, { area: 2500, maxWidth: 88, maxHeight: 40 }]) {
    const boxes = partners.map((partner) => partnerBox(partner.width, partner.height, options));
    const areas = boxes.map((box) => box.width * box.height);
    const spread = Math.max(...areas) / Math.min(...areas);
    assert.ok(spread < 1.2, `visual areas within 20%: ${areas.join(", ")}`);
    for (const [i, partner] of partners.entries()) {
      assert.deepEqual(webPartnerBox(partner.width, partner.height, options), boxes[i], "web and email use the same sizing");
    }
  }
  assert.match(credential, /Official Event Partners/);
  assert.match(credential, /grid-cols-2 min-\[360px\]:grid-cols-3/);
});

test("13 & 32. one opaque QR credential per group, black on ivory, with a quiet zone", () => {
  assert.equal(isVipToken(token), true);
  assert.equal(isVipToken("VIP_" + "a1".repeat(24)), false);
  assert.equal(isVipToken("3f9a1c2e7b4d8a60f1e2d3c4b5a69788c21e"), false);
  assert.match(migration, /token text not null unique default \('vip_' \|\| encode\(extensions\.gen_random_bytes\(24\), 'hex'\)\)/);
  assert.match(delivery, /margin: 4/);
  assert.match(delivery, /dark: "#0F0F10", light: "#F6F1E8"/);
  assert.match(credential, /margin: 4/);
  assert.match(credential, /QRCode\.toString\(qrValue/);
  assert.match(passView, /qrValue=\{token\}/);
  const { html } = renderSample();
  assert.equal((html.match(/cid:vip-access/g) ?? []).length, 1);
  assert.match(html, /VIP-7K9M4Q/);
});

test("14–20. partial entry offers only the remaining seats and the database caps admissions", () => {
  assert.deepEqual(admitChoices(6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(admitChoices(4), [1, 2, 3, 4]);
  assert.deepEqual(admitChoices(1), [1]);
  assert.deepEqual(admitChoices(0), []);
  assert.deepEqual(admitChoices(9), [1, 2, 3, 4, 5, 6]);
  assert.match(doorPanel, /export function admitChoices\(remaining: number\)/);
  assert.match(doorPanel, /Admit \$\{count\} VIP \$\{count === 1 \? "guest" : "guests"\}/);
  assert.match(doorPanel, /VIP access complete/);
  assert.match(migration, /and x\.admitted \+ p_count <= x\.capacity/);
  assert.match(migration, /when x\.admitted \+ p_count = x\.capacity then 'fully_admitted' else 'partially_admitted'/);
});

test("21. concurrent scans are serialised by one conditional UPDATE, backed by a constraint", () => {
  const admit = migration.slice(migration.indexOf("create or replace function public.admit_vip_guests"));
  assert.match(admit, /update vip_invitations x\s+set admitted = x\.admitted \+ p_count/);
  assert.match(admit, /and x\.status in \('issued', 'partially_admitted'\)/);
  assert.doesNotMatch(admit, /select [^;]*admitted[^;]*into[^;]*;\s*if [^;]*<=/i, "no read-then-write race");
  assert.match(migration, /check \(admitted <= capacity\)/);
  assert.match(doorFn, /admin\.rpc\("admit_vip_guests"/);
});

test("22. revoked and cancelled passes are final and rejected at the door", () => {
  assert.match(migration, /old\.status in \('revoked', 'cancelled'\) and \(new\.status <> old\.status or new\.admitted <> old\.admitted\)/);
  assert.match(migration, /when v_inv\.status = 'revoked' then 'revoked'/);
  assert.match(adminFn, /\.in\("status", \["issued", "partially_admitted"\]\)/);
  assert.equal(revokePhraseOk("REVOKE"), true);
  assert.equal(revokePhraseOk("revoke"), false);
  assert.match(migration, /raise exception 'vip_invitations rows are kept for history'/);
  assert.match(doorPanel, /Pass revoked/);
  assert.deepEqual(publicVipPass({ status: "revoked", table_label: "T", host_name: "H", capacity: 2, admitted: 0, code: "VIP-AAAAAA" }, null, []), { status: "inactive" });
  assert.deepEqual(publicVipPass({ status: "cancelled" }, null, []), { status: "inactive" });
});

test("23–24. resend sends the same credential and cannot change the allocation", () => {
  const resend = adminFn.slice(adminFn.indexOf("async function vipResend"), adminFn.indexOf("async function vipRevoke"));
  assert.doesNotMatch(resend, /rpc\(|insert\(|capacity:/);
  assert.match(resend, /deliverVip\(row, actor, ip, ua, "VIP_INVITATION_RESENT"\)/);
  assert.match(migration, /or new\.capacity <> old\.capacity/);
  assert.match(migration, /or new\.token <> old\.token/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /vip_invitations_live_table_idx/);
});

test("25. the normal ticket scanner path is unchanged", () => {
  assert.match(doorFn, /if \(isVipToken\(token\)\) return json\(req, await vipLookup\(\{ token \}, eventId\)\);\s+if \(!TOKEN_RE\.test\(token\)\)/);
  assert.match(doorFn, /admin\.rpc\("check_in_ticket"/);
  assert.match(doorFn, /const TOKEN_RE = \/\^\[0-9a-f\]\{36\}\$\/;/);
});

test("26–28. VIP stays out of checkout, promo codes, Stripe, orders, and inventory", () => {
  const sql = migration.replace(/--.*$/gm, "");
  for (const pattern of [/\borders\b/, /\btickets\b/, /\btiers\b/, /checkout_holds/, /promotions?/, /stripe/i, /amount|price|currency/i]) {
    assert.doesNotMatch(sql, pattern);
  }
  const helpers = (delivery + read("supabase/functions/_shared/vip.mjs")).replace(/VIP_FORBIDDEN_GUEST_TERMS = .*$/m, "");
  assert.doesNotMatch(helpers, /stripe|GISO15|promo|\borders?\b/i);
  const vipAdmin = adminFn
    .slice(adminFn.indexOf("// Private VIP invitations."), adminFn.indexOf("// Cancellation stays off."))
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(vipAdmin, /stripe|from\("orders"\)|from\("tickets"\)|promotion/i);
});

test("29–30. only an aal2 super admin can issue, view, resend, or revoke", () => {
  for (const action of ["vip_list", "vip_view", "vip_preview", "vip_issue", "vip_resend", "vip_revoke"]) {
    assert.equal(permit("super_admin", action), true, action);
    assert.equal(permit("admin", action), false, action);
    assert.equal(permit("door_staff", action), false, action);
    assert.equal(permit(null, action), false, action);
    assert.equal(isReadAction(action) || isOpenMutation(action), true, action);
  }
  assert.equal(requiresMfa("super_admin"), true);
  assert.equal(rateLimitFor("vip_revoke").limit, 5);
  const gate = adminFn.indexOf("requiresMfa(actor.role) && actor.aal !== \"aal2\"");
  assert.ok(gate > 0 && gate < adminFn.indexOf('case "vip_issue":'), "MFA gate runs before any VIP action");
  assert.match(adminFn, /\.not\("action", "like", "VIP_%"\)/);
});

test("31. the public pass response and door view carry no sensitive data", () => {
  const row = {
    id: "2b1f6c0e-7a3d-4c1e-9f00-000000000000",
    event_id: "evt_diwali_night",
    table_label: "VIP TABLE 04",
    host_name: "Arjun Mehta",
    email: "arjun@example.com",
    phone: "+1 713 555 0100",
    admin_note: "Founder guest",
    issued_by: "9a9a9a9a-0000-0000-0000-000000000000",
    token,
    capacity: 6,
    admitted: 2,
    status: "partially_admitted",
    code: "VIP-7K9M4Q",
  };
  const pass = publicVipPass(row, vipEvent, partners);
  assert.deepEqual(Object.keys(pass).sort(), ["admitted", "capacity", "code", "event", "host", "partners", "remaining", "status", "table"]);
  const serialized = JSON.stringify(pass);
  for (const secret of [row.id, row.email, row.phone, row.admin_note, row.issued_by, row.token, "evt_diwali_night"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(pass.remaining, 4);
  assert.match(passFn, /\.select\("event_id, table_label, host_name, capacity, admitted, status, code"\)/);
  assert.match(passFn, /"Cache-Control": "private, no-store"/);
  assert.match(passFn, /"Referrer-Policy": "no-referrer"/);
  assert.match(passFn, /req\.method !== "POST"/);
  assert.match(doorFn, /const VIP_DOOR_COLUMNS = "event_id, code, table_label, host_name, capacity, admitted, status, last_entry_at";/);
  assert.match(config, /\[functions\.vip-pass\]\r?\nverify_jwt = false/);
  assert.match(nextConfig, /source: "\/vip", headers: \[\.\.\.sharedHeaders/);
  assert.match(read("public/.htaccess"), /<Files "vip\.html">/);
  assert.match(read("src/app/vip/layout.tsx"), /robots: \{ index: false, follow: false/);
  assert.match(passView, /window\.location\.hash/);
});

test("input validation keeps labels, notes, and phones tidy", () => {
  assert.equal(parseVipHostName("  arjun   mehta "), "arjun mehta");
  assert.equal(parseVipHostName("<b>x</b>"), null);
  assert.equal(parseVipTableLabel("VIP TABLE 04"), "VIP TABLE 04");
  assert.equal(parseVipTableLabel("Founders Table"), "Founders Table");
  assert.equal(parseVipTableLabel("x".repeat(41)), null);
  assert.equal(parseVipTableLabel("<script>"), null);
  assert.equal(parseVipPhone(""), "");
  assert.equal(parseVipPhone("+1 (713) 555-0100"), "+1 (713) 555-0100");
  assert.equal(parseVipPhone("call me"), null);
  assert.equal(parseVipNote(""), "");
  assert.equal(parseVipNote("DJ Guest"), "DJ Guest");
  assert.equal(parseVipNote("x".repeat(201)), null);
  assert.equal(parseVipCode("vip-7k9m4q"), "VIP-7K9M4Q");
  assert.equal(parseVipCode("VIP-0OIL11"), null);
});

test("summary counts never exceed six per group", () => {
  const summary = vipSummary([
    { capacity: 6, admitted: 2, status: "partially_admitted" },
    { capacity: 4, admitted: 4, status: "fully_admitted" },
    { capacity: 1, admitted: 0, status: "issued" },
    { capacity: 6, admitted: 1, status: "revoked" },
  ]);
  assert.deepEqual(summary, { groups: 3, allocated: 11, admitted: 7, remaining: 5, revoked: 1, cancelled: 0 });
  assert.equal(vipEvent.title, "Indian Diwali Night");
  assert.equal(vipEvent.date, "November 7, 2026");
  assert.equal(vipEvent.shortDate, "Nov 7");
  assert.equal(vipEvent.city, "Houston");
});
