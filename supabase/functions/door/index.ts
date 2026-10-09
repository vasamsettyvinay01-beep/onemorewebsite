// Door staff API for the /door scanner. Requires a Supabase Auth session for
// an email listed in DOOR_EMAILS (the shared door login).
//
// POST { action: "scan",   eventId, token, device? }
// POST { action: "admit",  eventId, ticketId, device? }   manual check-in from the guest list
// POST { action: "stats",  eventId }
// POST { action: "search", eventId, q }

import { admin, corsHeaders, json } from "../_shared/http.ts";

const DOOR_EMAILS = (Deno.env.get("DOOR_EMAILS") ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const TOKEN_RE = /^[0-9a-f]{36}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(req, { error: "Sign in required" }, 401);
  const { data: auth } = await admin.auth.getUser(jwt);
  const staff = auth.user?.email?.toLowerCase();
  if (!staff || !DOOR_EMAILS.includes(staff)) return json(req, { error: "Not door staff" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Bad request" }, 400);
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const device = typeof body.device === "string" ? body.device.slice(0, 40) : null;
  if (!eventId) return json(req, { error: "eventId required" }, 400);
  const limit = body.action === "search" ? 40 : body.action === "stats" ? 180 : 400;
  if (!(await allow(`${body.action}:${staff}`, limit))) return json(req, { error: "Please wait a moment and try again." }, 429);

  try {
    switch (body.action) {
      case "scan": {
        const token = typeof body.token === "string" ? body.token.trim().toLowerCase() : "";
        if (!TOKEN_RE.test(token)) {
          await admin.from("scans").insert({ token: token.slice(0, 128) || "(empty)", outcome: "not-found", scanned_by: staff, device });
          return json(req, { outcome: "not-found" });
        }
        return json(req, await checkIn(token, eventId, staff, device));
      }

      case "admit": {
        const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
        const { data: ticket } = await admin.from("tickets").select("token").eq("id", ticketId).maybeSingle();
        if (!ticket) return json(req, { outcome: "not-found" });
        return json(req, await checkIn(ticket.token, eventId, staff, device ? `${device} (manual)` : "manual"));
      }

      case "stats": {
        const [{ data: tickets, error: tErr }, { data: scans, error: sErr }] = await Promise.all([
          admin.from("tickets").select("tier_id, status").eq("event_id", eventId),
          admin
            .from("scans")
            .select("outcome, scanned_by, device, created_at, tickets(guest_number, orders(purchaser_name, tier_name))")
            .order("created_at", { ascending: false })
            .limit(15),
        ]);
        if (tErr) throw tErr;
        if (sErr) throw sErr;
        const live = tickets.filter((t) => t.status !== "cancelled");
        const byTier: Record<string, { sold: number; in: number }> = {};
        for (const t of live) {
          byTier[t.tier_id] ??= { sold: 0, in: 0 };
          byTier[t.tier_id].sold++;
          if (t.status === "checked-in") byTier[t.tier_id].in++;
        }
        return json(req, {
          guests: live.length,
          inside: live.filter((t) => t.status === "checked-in").length,
          byTier,
          recent: scans,
        });
      }

      case "search": {
        const q = typeof body.q === "string" ? body.q.trim().slice(0, 80) : "";
        if (q.length < 2 || !/^[\p{L}\p{N}@.+_ -]+$/u.test(q)) return json(req, { orders: [] });
        const pattern = `%${q}%`;
        const columns = "id, purchaser_name, purchaser_email, tier_name, status, tickets(id, guest_number, status, checked_in_at, checked_in_by)";
        const [byName, byEmail] = await Promise.all([
          admin.from("orders").select(columns).eq("event_id", eventId).ilike("purchaser_name", pattern).order("created_at", { ascending: false }).limit(20),
          admin.from("orders").select(columns).eq("event_id", eventId).ilike("purchaser_email", pattern).order("created_at", { ascending: false }).limit(20),
        ]);
        if (byName.error) throw byName.error;
        if (byEmail.error) throw byEmail.error;
        const merged = new Map<string, (typeof byName.data)[number]>();
        for (const order of [...(byName.data ?? []), ...(byEmail.data ?? [])]) merged.set(order.id, order);
        const orders = [...merged.values()];
        for (const order of orders) order.tickets.sort((a, b) => a.guest_number - b.guest_number);
        return json(req, { orders });
      }

      default:
        return json(req, { error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json(req, { error: "Server error" }, 500);
  }
});

async function allow(bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc("allow_request", {
    p_bucket: bucket.slice(0, 120),
    p_limit: limit,
    p_window_seconds: 600,
  });
  if (error) return true;
  return data === true;
}

async function checkIn(token: string, eventId: string, staff: string, device: string | null) {
  const { data, error } = await admin.rpc("check_in_ticket", {
    p_token: token,
    p_event_id: eventId,
    p_scanned_by: staff,
    p_device: device,
  });
  if (error) throw error;
  return data[0];
}
