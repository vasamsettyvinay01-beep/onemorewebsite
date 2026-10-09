// Public read of one order's tickets for the /tickets page.
//   ?o=<access_token>      — the link in the ticket email
//   ?session=<pi_...>      — right after checkout, before the email lands

import { admin, corsHeaders, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim().slice(0, 64) || "unknown";
  const { data: allowed, error: limitErr } = await admin.rpc("allow_request", {
    p_bucket: `tickets:${ip}`,
    p_limit: 120,
    p_window_seconds: 600,
  });
  if (!limitErr && allowed === false) return json(req, { error: "Please wait a moment and try again." }, 429);

  const params = new URL(req.url).searchParams;
  const accessToken = params.get("o");
  const sessionId = params.get("session");

  let query = admin
    .from("orders")
    .select(
      "event_id, tier_name, purchaser_name, status, access_token, tickets(guest_number, token, status, checked_in_at)",
    );
  if (accessToken && /^[0-9a-f]{48}$/.test(accessToken)) query = query.eq("access_token", accessToken);
  else if (sessionId && /^(cs_(test|live)_|pi_)[A-Za-z0-9]{10,200}$/.test(sessionId)) query = query.eq("stripe_session_id", sessionId);
  else return json(req, { error: "Not found" }, 404);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("ticket-view query failed");
    return json(req, { error: "Server error" }, 500);
  }
  // Webhook may still be in flight right after checkout; the page polls on 404.
  if (!data) return json(req, { error: "Not found" }, 404);

  data.tickets.sort((a, b) => a.guest_number - b.guest_number);
  return json(req, {
    event_id: data.event_id,
    tier_name: data.tier_name,
    purchaser_name: data.purchaser_name,
    status: data.status,
    access_token: data.access_token,
    tickets: data.tickets.map((ticket) => ({
      guest_number: ticket.guest_number,
      token: ticket.token,
      status: ticket.status,
      checked_in_at: ticket.checked_in_at,
    })),
  });
});
