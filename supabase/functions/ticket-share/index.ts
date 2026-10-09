// Per-ticket share links. The purchaser's order access token authorizes create and revoke.
// The database stores only a SHA-256 of the share token. A share is not a second admission.
//
// The raw token belongs in the URL fragment, then in this POST body. GET is rejected so the
// token is never taken from a query string. Nothing here writes audit_log or logs the token.

import { admin, corsHeaders, json } from "../_shared/http.ts";

const ACCESS_RE = /^[0-9a-f]{48}$/;
const SHARE_RE = /^[0-9a-f]{64}$/;
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
  if (body.action === "create" || body.action === "revoke") return mutate(req, body, body.action);
  return reply(req, NOT_FOUND, 404);
});

async function readShareRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!(await allow(`share-read:${clientIp(req)}`, 80))) return wait(req);
  const token = typeof body.token === "string" ? body.token : "";
  if (!SHARE_RE.test(token)) return reply(req, NOT_FOUND, 404);
  const view = await readShare(await sha256(token));
  if (!view) return reply(req, NOT_FOUND, 404);
  return reply(req, view);
}

async function mutate(req: Request, body: Record<string, unknown>, action: "create" | "revoke"): Promise<Response> {
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const guestNumber = Number(body.guestNumber);
  if (!ACCESS_RE.test(accessToken) || !Number.isInteger(guestNumber) || guestNumber < 1) {
    return reply(req, NOT_FOUND, 404);
  }
  const owner = (await sha256(accessToken)).slice(0, 24);
  const bucket = action === "create" ? `share-create:${owner}` : `share-revoke:${owner}`;
  if (!(await allow(bucket, 12)) || !(await allow(`share-mutate:${clientIp(req)}`, 30))) return wait(req);

  const { data: order } = await admin
    .from("orders")
    .select("id, tickets(id, guest_number)")
    .eq("access_token", accessToken)
    .maybeSingle();
  const ticket = order?.tickets?.find((row: { guest_number: number }) => row.guest_number === guestNumber);
  if (!ticket) return reply(req, NOT_FOUND, 404);

  const { error: revokeError } = await admin
    .from("ticket_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("ticket_id", ticket.id)
    .is("revoked_at", null);
  if (revokeError) return reply(req, { error: "Server error" }, 500);
  if (action === "revoke") return reply(req, { ok: true });

  const token = randomToken();
  const { error } = await admin.from("ticket_shares").insert({ ticket_id: ticket.id, token_hash: await sha256(token) });
  if (error) return reply(req, { error: "Server error" }, 500);
  const site = (Deno.env.get("SITE_URL") ?? "https://theonemorecompany.com").replace(/\/$/, "");
  return reply(req, { url: `${site}/tickets/shared#${token}` });
}

async function readShare(hash: string) {
  const { data: share } = await admin.from("ticket_shares").select("revoked_at, ticket_id").eq("token_hash", hash).maybeSingle();
  if (!share || share.revoked_at) return null;
  const { data: ticket } = await admin
    .from("tickets")
    .select("guest_number, token, status, checked_in_at, event_id, order_id, orders(status, tier_name)")
    .eq("id", share.ticket_id)
    .maybeSingle();
  if (!ticket) return null;
  const order = Array.isArray(ticket.orders) ? ticket.orders[0] : ticket.orders;
  return {
    guestNumber: ticket.guest_number,
    admissionCode: ticket.token,
    status: ticket.status,
    checkedInAt: ticket.checked_in_at,
    eventId: ticket.event_id,
    tierName: order?.tier_name ?? "",
    orderStatus: order?.status ?? "paid",
    reference: ticket.token.slice(-6).toUpperCase(),
  };
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
