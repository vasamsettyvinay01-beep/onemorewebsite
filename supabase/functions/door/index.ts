// Door staff API for the /door scanner.
//
// A caller is authorized only after the Supabase session is validated here.
// Staff role is read from staff_roles. Request body, query string, and browser
// storage cannot grant access. Admin and super_admin also need aal2.
// The legacy door login remains allowed until it is retired.
//
// POST { action: "session" }                                server-resolved email and role
// POST { action: "scan",   eventId, token, device? }
// POST { action: "admit",  eventId, ticketId, device? }   manual check-in from the guest list
// POST { action: "stats",  eventId }
// POST { action: "search", eventId, q }
// POST { action: "vip_lookup", eventId, code }             reopen a VIP group from the guest list
// POST { action: "vip_admit",  eventId, code, count, device? }
//
// A VIP credential scans like a ticket but never admits on scan. The door sees
// the group and chooses how many guests are entering; vip_admit is atomic.

import { admin, corsHeaders, json } from "../_shared/http.ts";
import { canUseScanner, resolveRole } from "../_shared/staff-auth.mjs";
import { isVipToken, parseVipAdmitCount, parseVipCode, vipRemaining } from "../_shared/vip.mjs";

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
  const legacyDoor = Boolean(staff && DOOR_EMAILS.includes(staff));
  const roleLookup = !legacyDoor && auth.user
    ? await admin.from("staff_roles").select("role").eq("user_id", auth.user.id).maybeSingle()
    : null;
  const role = roleLookup && !roleLookup.error ? resolveRole(roleLookup.data?.role) : null;
  const allowed = canUseScanner({ role, aal: jwtAal(jwt), legacyDoor });
  if (!staff || !allowed) {
    try {
      await admin.rpc("record_audit", {
        p_actor_id: auth.user?.id ?? null,
        p_actor_role: role ?? null,
        p_action: "door_login_rejected",
        p_resource_type: "door",
        p_resource_id: null,
        p_summary: staff ? { email: staff } : {},
        p_ip: (req.headers.get("x-forwarded-for") ?? "").slice(0, 64),
        p_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      });
    } catch {
      // A missing audit function must not turn a rejection into a server error.
    }
    const needsMfa = role === "admin" || role === "super_admin";
    return json(req, { error: needsMfa ? "Multi-factor authentication is required." : "Not door staff" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Bad request" }, 400);
  }
  if (body.action === "session") {
    if (!(await allow(`session:${staff}`, 60))) return json(req, { error: "Please wait a moment and try again." }, 429);
    return json(req, { email: staff, role: legacyDoor ? "legacy" : role });
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
        if (isVipToken(token)) return json(req, await vipLookup({ token }, eventId));
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

      case "vip_lookup": {
        const code = parseVipCode(body.code);
        if (!code) return json(req, { outcome: "not-found" });
        return json(req, await vipLookup({ code }, eventId));
      }

      case "vip_admit": {
        const code = parseVipCode(body.code);
        const count = parseVipAdmitCount(body.count);
        if (!code || count == null) return json(req, { outcome: "invalid-count" });
        const { data, error } = await admin.rpc("admit_vip_guests", {
          p_code: code,
          p_event_id: eventId,
          p_count: count,
          p_scanned_by: staff,
          p_device: device,
        });
        if (error) throw error;
        const row = (Array.isArray(data) ? data[0] : data) as VipAdmitRow | null;
        if (!row) throw new Error("vip_admit_empty");
        await doorAudit(
          auth.user?.id ?? null,
          legacyDoor ? null : role,
          row.outcome === "admitted" ? "VIP_GUESTS_ADMITTED" : "VIP_ADMISSION_REJECTED",
          {
            code,
            requested: count,
            admitted_now: row.admitted_now,
            admitted: row.admitted,
            remaining: row.remaining,
            capacity: row.capacity,
            outcome: row.outcome,
            operator: staff,
            device,
          },
          req,
        );
        return json(req, {
          outcome: row.outcome === "admitted" ? "vip-admitted" : row.outcome === "not-found" ? "not-found" : "vip-rejected",
          reason: row.outcome,
          admittedNow: row.admitted_now,
          vip: row.code ? vipView(row) : null,
        });
      }

      case "stats": {
        const [{ data: tickets, error: tErr }, { data: scans, error: sErr }, { data: vipRows, error: vErr }] = await Promise.all([
          admin.from("tickets").select("tier_id, status").eq("event_id", eventId),
          admin
            .from("scans")
            .select("outcome, scanned_by, device, created_at, tickets(guest_number, orders(purchaser_name, tier_name))")
            .order("created_at", { ascending: false })
            .limit(15),
          admin.from("vip_invitations").select("capacity, admitted, status").eq("event_id", eventId),
        ]);
        if (tErr) throw tErr;
        if (sErr) throw sErr;
        if (vErr) throw vErr;
        const vip = { allocated: 0, admitted: 0 };
        for (const row of vipRows ?? []) {
          vip.admitted += row.admitted;
          if (row.status !== "revoked" && row.status !== "cancelled") vip.allocated += row.capacity;
        }
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
          vip,
          recent: scans,
        });
      }

      case "search": {
        const q = typeof body.q === "string" ? body.q.trim().slice(0, 80) : "";
        if (q.length < 2 || !/^[\p{L}\p{N}@.+_ -]+$/u.test(q)) return json(req, { orders: [] });
        const pattern = `%${q}%`;
        const columns = "id, purchaser_name, purchaser_email, tier_name, status, tickets(id, guest_number, guest_name, status, checked_in_at, checked_in_by)";
        const vipPattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        const [byName, byEmail, byGuest, vipHosts, vipTables] = await Promise.all([
          admin.from("orders").select(columns).eq("event_id", eventId).ilike("purchaser_name", pattern).order("created_at", { ascending: false }).limit(20),
          admin.from("orders").select(columns).eq("event_id", eventId).ilike("purchaser_email", pattern).order("created_at", { ascending: false }).limit(20),
          admin.from("tickets").select("order_id").eq("event_id", eventId).ilike("guest_name", pattern).limit(20),
          admin.from("vip_invitations").select(VIP_DOOR_COLUMNS).eq("event_id", eventId).ilike("host_name", vipPattern).limit(10),
          admin.from("vip_invitations").select(VIP_DOOR_COLUMNS).eq("event_id", eventId).ilike("table_label", vipPattern).limit(10),
        ]);
        if (byName.error) throw byName.error;
        if (byEmail.error) throw byEmail.error;
        if (byGuest.error) throw byGuest.error;
        if (vipHosts.error) throw vipHosts.error;
        if (vipTables.error) throw vipTables.error;
        const vipMatches = new Map<string, VipDoorRow>();
        for (const row of [...(vipHosts.data ?? []), ...(vipTables.data ?? [])] as VipDoorRow[]) vipMatches.set(row.code, row);
        const guestOrderIds = [...new Set((byGuest.data ?? []).map((row) => row.order_id))];
        const byGuestName = guestOrderIds.length
          ? await admin.from("orders").select(columns).in("id", guestOrderIds)
          : { data: [], error: null };
        if (byGuestName.error) throw byGuestName.error;
        const merged = new Map<string, (typeof byName.data)[number]>();
        for (const order of [...(byName.data ?? []), ...(byEmail.data ?? []), ...(byGuestName.data ?? [])]) merged.set(order.id, order);
        const orders = [...merged.values()];
        for (const order of orders) order.tickets.sort((a, b) => a.guest_number - b.guest_number);
        return json(req, { orders, vip: [...vipMatches.values()].map(vipView) });
      }

      default:
        return json(req, { error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json(req, { error: "Server error" }, 500);
  }
});

function jwtAal(jwt: string): string {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.aal === "string" ? payload.aal : "aal1";
  } catch {
    return "aal1";
  }
}

async function allow(bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc("allow_request", {
    p_bucket: bucket.slice(0, 120),
    p_limit: limit,
    p_window_seconds: 600,
  });
  if (error) return true;
  return data === true;
}

const VIP_DOOR_COLUMNS = "event_id, code, table_label, host_name, capacity, admitted, status, last_entry_at";

interface VipDoorRow {
  event_id?: string;
  code: string;
  table_label: string;
  host_name: string;
  capacity: number;
  admitted: number;
  status: string;
  last_entry_at: string | null;
}

interface VipAdmitRow extends VipDoorRow {
  outcome: string;
  remaining: number;
  admitted_now: number;
}

/** What the door may see: no email, phone, admin note, issuer, token, or row id. */
function vipView(row: VipDoorRow) {
  return {
    code: row.code,
    table: row.table_label,
    host: row.host_name,
    capacity: row.capacity,
    admitted: row.admitted,
    remaining: vipRemaining(row.capacity, row.admitted),
    status: row.status,
    lastEntryAt: row.last_entry_at,
  };
}

async function vipLookup(by: { token: string } | { code: string }, eventId: string) {
  const query = admin.from("vip_invitations").select(VIP_DOOR_COLUMNS);
  const { data, error } = await ("token" in by ? query.eq("token", by.token) : query.eq("code", by.code)).maybeSingle();
  if (error) throw error;
  if (!data) return { outcome: "not-found" };
  if (data.event_id !== eventId) return { outcome: "wrong-event" };
  return { outcome: "vip", vip: vipView(data as VipDoorRow) };
}

async function doorAudit(actorId: string | null, role: string | null, action: string, summary: Record<string, unknown>, req: Request) {
  try {
    await admin.rpc("record_audit", {
      p_actor_id: actorId,
      p_actor_role: role === "super_admin" || role === "admin" || role === "door_staff" ? role : null,
      p_action: action,
      p_resource_type: "vip",
      p_resource_id: typeof summary.code === "string" ? summary.code : null,
      p_summary: summary,
      p_ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
      p_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
    });
  } catch (err) {
    console.error(JSON.stringify({ msg: "vip_audit_failed", error: (err as Error).message?.slice(0, 160) }));
  }
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
