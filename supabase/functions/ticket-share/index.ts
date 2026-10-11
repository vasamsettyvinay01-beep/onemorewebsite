// Per-ticket invitations. The purchaser's order access token authorizes create, revoke, and email.
// The database stores only a SHA-256 of the share token. A share is not a second admission.
// The buyer keeps every pass. Sending replaces the previous invitation for that one pass.
//
// The raw token belongs in the URL fragment, then in this POST body. GET is rejected so the
// token is never taken from a query string. Nothing here writes audit_log or logs the token.

import { sendGuestPassEmail } from "../_shared/email.ts";
import { cleanGuestName, properName } from "../_shared/guest-name.ts";
import { admin, corsHeaders, json } from "../_shared/http.ts";

const ACCESS_RE = /^[0-9a-f]{48}$/;
const SHARE_RE = /^[0-9a-f]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_FOUND = { error: "Not found" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (!originOk(req)) return reply(req, { error: "Forbidden" }, 403);
  if (req.method === "GET") return reply(req, NOT_FOUND, 404);
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(req, NOT_FOUND, 404);
  }

  if (body.action === "read") return readShareRequest(req, body);
  if (body.action === "claim") return claim(req, body);
  if (body.action === "email") return emailPass(req, body);
  if (body.action === "create" || body.action === "revoke") return mutate(req, body, body.action);
  return reply(req, NOT_FOUND, 404);
});

async function readShareRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!(await allow(`share-read:${clientIp(req)}`, 80))) return wait(req);
  const token = typeof body.token === "string" ? body.token : "";
  if (!SHARE_RE.test(token)) return reply(req, NOT_FOUND, 404);
  const hash = await sha256(token);
  const view = await readShare(hash);
  if (!view) return reply(req, NOT_FOUND, 404);
  await admin.from("ticket_shares").update({ opened_at: new Date().toISOString() }).eq("token_hash", hash).is("opened_at", null).is("revoked_at", null);
  return reply(req, view);
}

async function claim(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!(await allow(`share-claim:${clientIp(req)}`, 20))) return wait(req);
  const token = typeof body.token === "string" ? body.token : "";
  const name = cleanGuestName(body.name);
  if (!SHARE_RE.test(token) || !name) return reply(req, { error: "Enter your name as it appears on your photo ID." }, 400);
  const hash = await sha256(token);
  const { data: claimed, error } = await admin.rpc("claim_ticket_share", {
    p_token_hash: hash,
    p_guest_name: name,
  });
  if (error) return reply(req, { error: "Server error" }, 500);
  if (typeof claimed !== "string") return reply(req, { error: "This pass can no longer be renamed." }, 409);
  return reply(req, { guestName: claimed });
}

async function emailPass(req: Request, body: Record<string, unknown>): Promise<Response> {
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const guestNumber = Number(body.guestNumber);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  if (!ACCESS_RE.test(accessToken) || !Number.isInteger(guestNumber) || guestNumber < 1 || !EMAIL_RE.test(email)) {
    return reply(req, { error: "Enter a valid email." }, 400);
  }
  const owner = (await sha256(accessToken)).slice(0, 24);
  if (!(await allow(`share-email:${owner}`, 24)) || !(await allow(`share-mutate:${clientIp(req)}`, 30))) return wait(req);

  const found = await ownedTicket(accessToken, guestNumber);
  if (!found) return reply(req, NOT_FOUND, 404);
  if (found.blocked) return reply(req, { error: "This pass can no longer be sent." }, 409);

  const issued = await prepareShare(found.ticketId);
  if (!issued) return reply(req, { error: "Server error" }, 500);

  try {
    await sendGuestPassEmail({
      to: email,
      token: found.admissionCode,
      senderName: found.senderName,
      eventName: found.eventName,
      dateLabel: found.dateLabel,
      timeLabel: found.timeLabel,
      venueName: found.venueName,
      tierName: found.tierName,
      guestNumber,
      total: found.total,
      reference: found.admissionCode.slice(-6).toUpperCase(),
      passUrl: shareUrl(issued),
    });
  } catch (err) {
    console.error("guest pass email failed", err instanceof Error ? err.message : "error");
    await deletePreparedShare(issued);
    return reply(req, { error: "Could not send the pass. Try again." }, 502);
  }
  if (!(await activateShare(found.ticketId, issued))) {
    await deletePreparedShare(issued);
    return reply(req, { error: "Pass sent, but its private link could not be activated. Please send it again." }, 500);
  }
  return reply(req, { ok: true });
}

async function mutate(req: Request, body: Record<string, unknown>, action: "create" | "revoke"): Promise<Response> {
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const guestNumber = Number(body.guestNumber);
  if (!ACCESS_RE.test(accessToken) || !Number.isInteger(guestNumber) || guestNumber < 1) {
    return reply(req, NOT_FOUND, 404);
  }
  const owner = (await sha256(accessToken)).slice(0, 24);
  const bucket = action === "create" ? `share-create:${owner}` : `share-revoke:${owner}`;
  if (!(await allow(bucket, 30)) || !(await allow(`share-mutate:${clientIp(req)}`, 30))) return wait(req);

  const found = await ownedTicket(accessToken, guestNumber);
  if (!found) return reply(req, NOT_FOUND, 404);
  if (action === "create" && found.blocked) return reply(req, { error: "This pass can no longer be sent." }, 409);

  if (action === "revoke") {
    const { error } = await revokeActive(found.ticketId);
    if (error) return reply(req, { error: "Server error" }, 500);
    return reply(req, { ok: true });
  }

  const issued = await prepareShare(found.ticketId);
  if (!issued) return reply(req, { error: "Server error" }, 500);
  if (!(await activateShare(found.ticketId, issued))) {
    await deletePreparedShare(issued);
    return reply(req, { error: "Server error" }, 500);
  }
  return reply(req, { url: shareUrl(issued) });
}

async function ownedTicket(accessToken: string, guestNumber: number) {
  const { data: order } = await admin
    .from("orders")
    .select("id, status, event_id, tier_id, purchaser_name, tier_name, tickets(id, guest_number, token, status)")
    .eq("access_token", accessToken)
    .maybeSingle();
  const ticket = order?.tickets?.find((row: { guest_number: number }) => row.guest_number === guestNumber);
  if (!order || !ticket) return null;
  const { data: tier } = await admin
    .from("tiers")
    .select("metadata")
    .eq("event_id", order.event_id)
    .eq("tier_id", order.tier_id)
    .maybeSingle();
  const metadata = stringMeta((tier?.metadata ?? {}) as Record<string, unknown>);
  const named = properName(order.purchaser_name);
  return {
    ticketId: ticket.id as string,
    admissionCode: ticket.token as string,
    tierName: (order.tier_name as string) || "Pass",
    total: order.tickets.length,
    senderName: named?.split(" ")[0] ?? "A guest",
    eventName: metadata.omc_event_name || "One More",
    dateLabel: metadata.omc_event_date || "",
    timeLabel: metadata.omc_event_time || "",
    venueName: metadata.omc_venue_name || "",
    blocked: order.status === "refunded" || ticket.status !== "valid",
  };
}

async function prepareShare(ticketId: string): Promise<string | null> {
  const token = randomToken();
  const { error } = await admin.from("ticket_shares").insert({
    ticket_id: ticketId,
    token_hash: await sha256(token),
    revoked_at: new Date().toISOString(),
  });
  return error ? null : token;
}

async function activateShare(ticketId: string, token: string): Promise<boolean> {
  const { data, error } = await admin.rpc("activate_ticket_share", {
    p_ticket_id: ticketId,
    p_token_hash: await sha256(token),
    p_clear_name: true,
  });
  return !error && data === true;
}

async function deletePreparedShare(token: string): Promise<void> {
  await admin.from("ticket_shares").delete().eq("token_hash", await sha256(token)).not("revoked_at", "is", null);
}

function revokeActive(ticketId: string) {
  return admin.rpc("revoke_ticket_share", {
    p_ticket_id: ticketId,
    p_clear_name: true,
  });
}

async function readShare(hash: string) {
  const { data: share } = await admin.from("ticket_shares").select("revoked_at, ticket_id").eq("token_hash", hash).maybeSingle();
  if (!share || share.revoked_at) return null;
  const { data: ticket } = await admin
    .from("tickets")
    .select("guest_number, token, status, checked_in_at, guest_name, event_id, order_id, orders(status, tier_name, purchaser_name)")
    .eq("id", share.ticket_id)
    .maybeSingle();
  if (!ticket) return null;
  const order = Array.isArray(ticket.orders) ? ticket.orders[0] : ticket.orders;
  const { count } = await admin.from("tickets").select("id", { count: "exact", head: true }).eq("order_id", ticket.order_id);
  const sender = properName(order?.purchaser_name);
  return {
    guestNumber: ticket.guest_number,
    guestName: ticket.guest_name,
    senderName: sender?.split(" ")[0] ?? null,
    admissionCode: ticket.token,
    status: ticket.status,
    checkedInAt: ticket.checked_in_at,
    eventId: ticket.event_id,
    tierName: order?.tier_name ?? "",
    orderStatus: order?.status ?? "paid",
    total: count ?? 1,
    reference: ticket.token.slice(-6).toUpperCase(),
  };
}

function shareUrl(token: string): string {
  const site = (Deno.env.get("SITE_URL") ?? "https://theonemorecompany.com").replace(/\/$/, "");
  return `${site}/tickets/shared#${token}`;
}

function stringMeta(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim().slice(0, 64) || "unknown";
}

/** Mutations and lookups fail closed when the limiter cannot be read. */
async function allow(bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc("allow_request", {
    p_bucket: bucket.slice(0, 120),
    p_limit: limit,
    p_window_seconds: 600,
  });
  if (error || data !== true) return false;
  return true;
}

function originOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET" || req.method === "OPTIONS";
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  return origin === site || origin === site.replace("://", "://www.") || /^http:\/\/localhost:\d+$/.test(origin);
}

function wait(req: Request): Response {
  return reply(req, { error: "Please wait a moment and try again." }, 429);
}

function reply(req: Request, body: unknown, status = 200): Response {
  const res = json(req, body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(res.body, { status: res.status, headers });
}
