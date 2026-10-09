// Read-only operations API. A caller must be a Supabase Auth user with a
// staff_roles role of admin or super_admin, and an authenticator session (aal2).
// The legacy door login is not an admin credential. Role is resolved here.
// Refunds, cancellation, price changes, and staff changes are rejected.

import { admin, corsHeaders, json } from "../_shared/http.ts";
import {
  permit,
  rateLimitAllows,
  rateLimitFor,
  requiresMfa,
  resolveRole,
  sanitizeAuditSummary,
} from "../_shared/staff-auth.mjs";
import {
  checkInPercent,
  cleanSearch,
  dayKey,
  displayScanResult,
  displayTicketStatus,
  emailLabel,
  isBlockedAction,
  isLegacyDoorAccount,
  isReadAction,
  likePattern,
  orderRefFromId,
  parseCheckinFilter,
  parseDay,
  parseEventId,
  parseOrderRef,
  parsePage,
  parsePaymentStatus,
  parseRefundStatus,
  parseTicketRef,
  parseTicketStatus,
  parseTierId,
  redactAudit,
  refundLabel,
  safeResource,
  splitCharge,
  ticketRefFromId,
  zoneForVenue,
} from "../_shared/admin-read.mjs";

// Canonical names live on the server. Cancellation must match this, not a name the browser sends.
const EVENT_NAMES: Record<string, string> = {
  evt_diwali_night: "Diwali Night",
};

type Role = "super_admin" | "admin";
interface Actor {
  id: string;
  email: string;
  role: Role;
  aal: string;
}

interface TierRow {
  event_id: string;
  tier_id: string;
  name: string;
  price_cents: number;
  currency: string;
  admits: number;
  capacity: number | null;
  active: boolean;
  metadata: Record<string, string> | null;
}

interface OrderRow {
  id: string;
  event_id: string;
  tier_id: string;
  tier_name: string;
  quantity: number;
  purchaser_name: string | null;
  purchaser_email: string;
  amount_total: number;
  currency: string;
  status: string;
  emailed_at: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  if (!originOk(req)) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Bad request" }, 400);
  }
  const action = typeof body.action === "string" && /^[a-z_]{1,40}$/.test(body.action) ? body.action : "";
  if (!action) return json(req, { error: "Bad request" }, 400);
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);

  if (action === "login_failed") {
    const limit = rateLimitFor(action);
    if (!(await allow(`admin-login:${ip}`, limit.limit, limit.windowSeconds))) {
      return json(req, { error: "Please wait a moment and try again." }, 429);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
    await audit(null, "AUTH_ATTEMPT_FAILED", "session", null, { email }, ip, ua);
    return json(req, { ok: true });
  }

  const actor = await identify(req, ip, ua);
  if (actor instanceof Response) return actor;
  const limit = rateLimitFor(action);
  if (!(await allow(`admin:${actor.id}:${action}`, limit.limit, limit.windowSeconds))) {
    await audit(actor, "rate_limited", "admin", action, {}, ip, ua);
    return json(req, { error: "Please wait a moment and try again." }, 429);
  }
  if (isBlockedAction(action)) {
    await audit(actor, "admin_mutation_rejected", "admin", action, {}, ip, ua);
    return json(req, { error: "This action is not available.", code: "not_available" }, 403);
  }
  if (!permit(actor.role, action) || !isReadAction(action)) return json(req, { error: "Not authorised" }, 403);
  if (requiresMfa(actor.role) && actor.aal !== "aal2") {
    return json(req, { error: "Multi-factor authentication is required.", code: "mfa_required" }, 403);
  }

  try {
    switch (action) {
      case "whoami":
        return json(req, { email: actor.email, role: actor.role });
      case "overview":
        return asResult(req, await overview(textEvent(body)));
      case "events":
        return asResult(req, await events());
      case "orders":
        return asResult(req, await listOrders(body));
      case "order":
        return asResult(req, await orderDetail(body));
      case "tickets":
        return asResult(req, await listTickets(body));
      case "ticket":
        return asResult(req, await ticketDetail(body));
      case "checkin":
        return asResult(req, await checkin(body));
      case "sales":
        return asResult(req, await sales(textEvent(body)));
      case "audit":
        return asResult(req, await auditPage(body));
      default:
        return json(req, { error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: "admin_error", action, error: (err as Error).message?.slice(0, 300) }));
    return json(req, { error: "Server error" }, 500);
  }
});

async function identify(req: Request, ip: string, ua: string): Promise<Actor | Response> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!jwt || jwt.split(".").length !== 3) return json(req, { error: "Sign in required" }, 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user?.email || !data.user.id) return json(req, { error: "Sign in required" }, 401);
  const email = data.user.email.toLowerCase();
  const { data: row, error: roleError } = await admin.from("staff_roles").select("role").eq("user_id", data.user.id).maybeSingle();
  if (roleError) return json(req, { error: "Server error" }, 500);
  const role = resolveRole(row?.role);
  if (isLegacyDoorAccount(email, Deno.env.get("DOOR_EMAILS") ?? "") || !role || role === "door_staff") {
    await audit(null, "admin_access_denied", "session", null, { email }, ip, ua, role === "door_staff" ? "door_staff" : null);
    return json(req, { error: "Not authorised" }, 403);
  }
  return { id: data.user.id, email, role, aal: jwtAal(jwt) };
}

function jwtAal(jwt: string): string {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.aal === "string" ? payload.aal : "aal1";
  } catch {
    return "aal1";
  }
}

function asResult(req: Request, body: { error?: string }) {
  if (body.error && Object.keys(body).length === 1) {
    const missing = body.error === "Order not found" || body.error === "Ticket not found" || body.error === "Event not found";
    return json(req, body, missing ? 404 : 400);
  }
  return json(req, body);
}

function textEvent(body: Record<string, unknown>): string {
  return parseEventId(body.eventId) ?? "";
}

async function loadTiers(): Promise<TierRow[]> {
  const { data, error } = await admin
    .from("tiers")
    .select("event_id, tier_id, name, price_cents, currency, admits, capacity, active, metadata")
    .order("event_id");
  if (error) throw error;
  return (data ?? []) as TierRow[];
}

async function eventOps(eventId: string) {
  const { data, error } = await admin.from("event_ops").select("status, cancel_reason").eq("event_id", eventId).maybeSingle();
  if (error) throw error;
  return data;
}

function eventProfile(tiers: TierRow[], salesStatus: string | null) {
  const meta = tiers.find((tier) => tier.metadata && Object.keys(tier.metadata).length)?.metadata ?? {};
  const active = tiers.some((tier) => tier.active);
  let status = "Closed";
  if (salesStatus === "cancelled") status = "Cancelled";
  else if (salesStatus === "paused") status = "Sales paused";
  else if (active) status = "On sale";
  return {
    name: meta.omc_event_name || tiers[0]?.event_id || "Event",
    date: meta.omc_event_date || null,
    time: meta.omc_event_time || null,
    venue: meta.omc_venue_name || null,
    address: meta.omc_venue_address || null,
    age: meta.omc_min_age || null,
    salesStatus: salesStatus ?? "open",
    status,
    timezone: zoneForVenue(meta.omc_venue_name, meta.omc_venue_address),
  };
}

async function scanRows<T>(
  table: "orders" | "tickets",
  columns: string,
  eventId: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const query = table === "orders"
      ? admin.from(table).select(columns).eq("event_id", eventId).eq("is_test", false)
      : admin.from(table).select(`${columns}, orders!inner(is_test)`).eq("event_id", eventId).eq("orders.is_test", false);
    const { data, error } = await query.range(from, from + 499);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 500) break;
  }
  return rows;
}

async function holdMap(eventId: string) {
  const { data, error } = await admin.rpc("event_holds", { p_event_id: eventId });
  if (error) throw error;
  const holds = new Map<string, number>();
  for (const row of (data ?? []) as { tier_id: string; quantity: number }[]) holds.set(row.tier_id, row.quantity);
  return holds;
}

async function metrics(eventId: string) {
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  if (!tiers.length) return { error: "Event not found" };
  const ops = await eventOps(eventId);
  const profile = eventProfile(tiers, ops?.status ?? null);
  const [orders, tickets, holds] = await Promise.all([
    scanRows<Pick<OrderRow, "id" | "tier_id" | "quantity" | "amount_total" | "status" | "created_at">>(
      "orders",
      "id, tier_id, quantity, amount_total, status, created_at",
      eventId,
    ),
    scanRows<{ id: string; tier_id: string; status: string; order_id: string }>(
      "tickets",
      "id, tier_id, status, order_id",
      eventId,
    ),
    holdMap(eventId),
  ]);
  const price = new Map(tiers.map((tier) => [tier.tier_id, tier]));
  let gross = 0;
  let subtotal = 0;
  let tax = 0;
  let refunded = 0;
  let split = true;
  const soldUnits = new Map<string, number>();
  const refundedUnits = new Map<string, number>();
  const revenue = new Map<string, number>();
  const days = new Map<string, { orders: number; charged: number; refunded: number; issued: number }>();
  for (const order of orders) {
    gross += order.amount_total;
    const tier = price.get(order.tier_id);
    const parts = tier ? splitCharge(order.amount_total, tier.price_cents, order.quantity) : null;
    if (!parts) split = false;
    else {
      subtotal += parts.subtotal;
      tax += parts.tax;
    }
    const day = dayKey(order.created_at, profile.timezone);
    if (day) {
      const bucket = days.get(day) ?? { orders: 0, charged: 0, refunded: 0, issued: 0 };
      bucket.orders += 1;
      bucket.charged += order.amount_total;
      bucket.issued += order.quantity * Math.max(tier?.admits ?? 1, 1);
      if (order.status === "refunded") bucket.refunded += order.amount_total;
      days.set(day, bucket);
    }
    if (order.status === "refunded") {
      refunded += order.amount_total;
      refundedUnits.set(order.tier_id, (refundedUnits.get(order.tier_id) ?? 0) + order.quantity);
    } else {
      soldUnits.set(order.tier_id, (soldUnits.get(order.tier_id) ?? 0) + order.quantity);
      revenue.set(order.tier_id, (revenue.get(order.tier_id) ?? 0) + order.amount_total);
    }
  }
  const issued = new Map<string, number>();
  const live = new Map<string, number>();
  let cancelled = 0;
  let checkedIn = 0;
  let activeAdmissions = 0;
  for (const ticket of tickets) {
    issued.set(ticket.tier_id, (issued.get(ticket.tier_id) ?? 0) + 1);
    if (ticket.status === "cancelled") cancelled += 1;
    else {
      activeAdmissions += 1;
      live.set(ticket.tier_id, (live.get(ticket.tier_id) ?? 0) + 1);
      if (ticket.status === "checked-in") checkedIn += 1;
    }
  }
  let cappedCapacity: number | null = null;
  let cappedRemaining: number | null = null;
  let uncapped = 0;
  const tierRows = tiers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tier) => {
      const units = soldUnits.get(tier.tier_id) ?? 0;
      const held = holds.get(tier.tier_id) ?? 0;
      const admits = Math.max(tier.admits ?? 1, 1);
      const remainingUnits = tier.capacity == null ? null : Math.max(tier.capacity - units - held, 0);
      if (tier.capacity == null) {
        if (tier.active) uncapped += 1;
      } else {
        cappedCapacity = (cappedCapacity ?? 0) + tier.capacity * admits;
        cappedRemaining = (cappedRemaining ?? 0) + (remainingUnits ?? 0) * admits;
      }
      let status = tier.active ? "On sale" : "Inactive";
      if (tier.capacity != null && remainingUnits === 0) status = "Sold out";
      return {
        id: tier.tier_id,
        name: tier.name,
        priceCents: tier.price_cents,
        currency: tier.currency,
        admits,
        unitsSold: units,
        unitsRefunded: refundedUnits.get(tier.tier_id) ?? 0,
        admissionsIssued: issued.get(tier.tier_id) ?? 0,
        admissionsOutstanding: live.get(tier.tier_id) ?? 0,
        capacity: tier.capacity,
        remaining: remainingUnits,
        holds: held,
        revenue: revenue.get(tier.tier_id) ?? 0,
        status,
      };
    });
  const activeHolds = [...holds.values()].reduce((sum, qty) => sum + qty, 0);
  const points = [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, bucket]) => ({ date, ...bucket }));
  return {
    event: { id: eventId, ...profile },
    currency: orders[0]?.currency ?? tiers[0]?.currency ?? "usd",
    grossSales: gross,
    orders: orders.length,
    admissionsSold: activeAdmissions,
    passesIssued: tickets.length,
    capacity: cappedCapacity,
    remainingCapacity: cappedRemaining,
    uncappedTiers: uncapped,
    checkedIn,
    guestsRemaining: Math.max(activeAdmissions - checkedIn, 0),
    ticketSubtotal: split ? subtotal : null,
    taxCollected: split ? tax : null,
    refundedAmount: refunded,
    cancelledPasses: cancelled,
    activeHolds,
    totalsComplete: split,
    tiers: tierRows,
    timeline: { timezone: profile.timezone, today: dayKey(new Date().toISOString(), profile.timezone), points },
  };
}

async function overview(eventId: string) {
  if (!eventId) return { error: "eventId required" };
  const summary = await metrics(eventId);
  if ("error" in summary) return summary;
  const { data, error } = await admin
    .from("orders")
    .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, amount_total, currency, status, emailed_at, created_at")
    .eq("event_id", eventId)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  const recent = await presentOrders((data ?? []) as OrderRow[], summary.tiers, summary.event.name);
  return { ...summary, recentOrders: recent };
}

async function events() {
  const tiers = await loadTiers();
  const ids = [...new Set(tiers.map((tier) => tier.event_id))];
  const list = [];
  for (const id of ids) {
    const summary = await metrics(id);
    if ("error" in summary) continue;
    list.push({
      id,
      name: summary.event.name,
      date: summary.event.date,
      time: summary.event.time,
      venue: summary.event.venue,
      address: summary.event.address,
      age: summary.event.age,
      status: summary.event.status,
      salesStatus: summary.event.salesStatus,
      currency: summary.currency,
      capacity: summary.capacity,
      remainingCapacity: summary.remainingCapacity,
      uncappedTiers: summary.uncappedTiers,
      unitsSold: summary.tiers.reduce((sum, tier) => sum + tier.unitsSold, 0),
      admissionsSold: summary.admissionsSold,
      passesIssued: summary.passesIssued,
      tiers: summary.tiers.map((tier) => ({
        id: tier.id,
        name: tier.name,
        priceCents: tier.priceCents,
        admits: tier.admits,
        capacity: tier.capacity,
        active: tier.status !== "Inactive",
      })),
    });
  }
  return { events: list };
}

async function sales(eventId: string) {
  if (!eventId) return { error: "eventId required" };
  const summary = await metrics(eventId);
  if ("error" in summary) return summary;
  return { currency: summary.currency, timeline: summary.timeline, tiers: summary.tiers };
}

function presentOrder(order: OrderRow, admissions: number, parts: { subtotal: number; tax: number; total: number } | null, eventName: string) {
  return {
    ref: orderRefFromId(order.id),
    purchaser: order.purchaser_name,
    email: order.purchaser_email,
    eventId: order.event_id,
    eventName,
    tier: order.tier_name,
    tierId: order.tier_id,
    units: order.quantity,
    admissions,
    subtotal: parts?.subtotal ?? null,
    tax: parts?.tax ?? null,
    total: order.amount_total,
    currency: order.currency,
    paymentStatus: order.status,
    refundStatus: refundLabel(order.status),
    emailStatus: emailLabel(order.emailed_at),
    createdAt: order.created_at,
  };
}

async function presentOrders(orders: OrderRow[], tiers: { id: string; priceCents: number }[], eventName: string) {
  if (!orders.length) return [];
  const prices = new Map(tiers.map((tier) => [tier.id, tier.priceCents]));
  const ids = orders.map((order) => order.id);
  const { data, error } = await admin.from("tickets").select("order_id").in("order_id", ids);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const ticket of data ?? []) counts.set(ticket.order_id, (counts.get(ticket.order_id) ?? 0) + 1);
  return orders.map((order) => {
    const unit = prices.get(order.tier_id);
    return presentOrder(order, counts.get(order.id) ?? 0, unit == null ? null : splitCharge(order.amount_total, unit, order.quantity), eventName);
  });
}

async function listOrders(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const page = parsePage(body.page, body.pageSize);
  const query = cleanSearch(body.q);
  const payment = parsePaymentStatus(body.paymentStatus);
  const refund = parseRefundStatus(body.refundStatus);
  const tierId = parseTierId(body.tierId);
  const fromDay = parseDay(body.from);
  const toDay = parseDay(body.to);
  if (!page || query === null || payment === null || refund === null || tierId === null || fromDay === null || toDay === null) {
    return { error: "Bad filter" };
  }
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  const profile = eventProfile(tiers, null);
  const ref = query ? parseOrderRef(query) : null;
  if (query && ref) {
    const ids = await idsWithPrefix("orders", eventId, ref);
    if (ids.length !== 1) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    const { data, error } = await admin
      .from("orders")
      .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, amount_total, currency, status, emailed_at, created_at")
      .eq("id", ids[0])
      .eq("event_id", eventId)
      .eq("is_test", false)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    const order = data as OrderRow;
    if (payment && order.status !== payment) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (!matchesRefund(order.status, refund)) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (tierId && order.tier_id !== tierId) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    const created = order.created_at.slice(0, 10);
    if (fromDay && created < fromDay) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (toDay && created > toDay) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    return { orders: await presentOrders([order], tiers, profile.name), page: 1, pageSize: page.pageSize, total: 1, eventName: profile.name };
  }

  let request = admin
    .from("orders")
    .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, amount_total, currency, status, emailed_at, created_at", { count: "exact" })
    .eq("event_id", eventId)
    .eq("is_test", false)
    .order("created_at", { ascending: false });
  if (payment) request = request.eq("status", payment);
  if (refund === "refunded") request = request.eq("status", "refunded");
  if (refund === "partial") request = request.eq("status", "partially-refunded");
  if (refund === "disputed") request = request.eq("status", "disputed");
  if (refund === "none") request = request.eq("status", "paid");
  if (tierId) request = request.eq("tier_id", tierId);
  if (fromDay) request = request.gte("created_at", `${fromDay}T00:00:00.000Z`);
  if (toDay) request = request.lte("created_at", `${toDay}T23:59:59.999Z`);
  if (query) {
    const pattern = likePattern(query);
    request = request.or(`purchaser_name.ilike."${pattern}",purchaser_email.ilike."${pattern}"`);
  }
  const { data, error, count } = await request.range(page.from, page.to);
  if (error) throw error;
  return {
    orders: await presentOrders((data ?? []) as OrderRow[], tiers, profile.name),
    page: page.page,
    pageSize: page.pageSize,
    total: count ?? 0,
    eventName: profile.name,
  };
}

async function orderDetail(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  if (!eventId || !prefix) return { error: "Order not found" };
  const ids = await idsWithPrefix("orders", eventId, prefix);
  if (ids.length !== 1) return { error: "Order not found" };
  const { data, error } = await admin
    .from("orders")
    .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, amount_total, currency, status, emailed_at, created_at")
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("is_test", false)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.event_id !== eventId) return { error: "Order not found" };
  const order = data as OrderRow;
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  const tier = tiers.find((item) => item.tier_id === order.tier_id);
  const { data: tickets, error: ticketError } = await admin
    .from("tickets")
    .select("id, guest_number, status, checked_in_at")
    .eq("order_id", order.id)
    .eq("event_id", eventId)
    .order("guest_number");
  if (ticketError) throw ticketError;
  const [presented] = await presentOrders([order], tiers, eventProfile(tiers, null).name);
  return {
    order: { ...presented, eventName: eventProfile(tiers, null).name },
    tickets: (tickets ?? []).map((ticket) => ({
      ref: ticketRefFromId(ticket.id),
      guestNumber: ticket.guest_number,
      status: displayTicketStatus(ticket.status, order.status),
      checkedInAt: ticket.checked_in_at,
    })),
    admits: tier?.admits ?? 1,
  };
}

async function listTickets(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const page = parsePage(body.page, body.pageSize);
  const query = cleanSearch(body.q);
  const status = parseTicketStatus(body.status);
  const checkinFilter = parseCheckinFilter(body.checkedIn);
  const tierId = parseTierId(body.tierId);
  if (!page || query === null || status === null || checkinFilter === null || tierId === null) return { error: "Bad filter" };
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  const ref = query ? parseTicketRef(query) : null;
  if (query && !ref) return { tickets: [], page: 1, pageSize: page.pageSize, total: 0 };

  let request = admin
    .from("tickets")
    .select("id, event_id, tier_id, guest_number, status, checked_in_at, order_id, orders!inner(id, tier_name, status, event_id, is_test)", { count: "exact" })
    .eq("event_id", eventId)
    .eq("orders.is_test", false)
    .order("created_at", { ascending: false });
  if (tierId) request = request.eq("tier_id", tierId);
  if (status === "valid") request = request.eq("status", "valid");
  if (status === "checked-in") request = request.eq("status", "checked-in");
  if (status === "cancelled") request = request.eq("status", "cancelled").neq("orders.status", "refunded");
  if (status === "refunded") request = request.eq("orders.status", "refunded");
  if (checkinFilter === "checked-in") request = request.eq("status", "checked-in");
  if (checkinFilter === "not-checked-in") request = request.neq("status", "checked-in");
  const names = new Map(tiers.map((tier) => [tier.tier_id, tier.name]));
  if (ref) {
    const matches: TicketJoin[] = [];
    for (let from = 0; from < 5000; from += 200) {
      const { data, error } = await request.range(from, from + 199);
      if (error) throw error;
      for (const row of (data ?? []) as unknown as TicketJoin[]) {
        if (String(row.id).startsWith(ref)) matches.push(row);
      }
      if (!data || data.length < 200) break;
    }
    return {
      tickets: matches.slice(page.from, page.to + 1).map((row) => ticketRow(row, names)),
      page: page.page,
      pageSize: page.pageSize,
      total: matches.length,
    };
  }
  const { data, error, count } = await request.range(page.from, page.to);
  if (error) throw error;
  const rows = (data ?? []) as unknown as TicketJoin[];
  return {
    tickets: rows.map((row) => ticketRow(row, names)),
    page: page.page,
    pageSize: page.pageSize,
    total: count ?? rows.length,
  };
}

function ticketRow(row: TicketJoin, names: Map<string, string>) {
  const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
  return {
    ref: ticketRefFromId(row.id),
    tier: names.get(row.tier_id) ?? order?.tier_name ?? row.tier_id,
    guestNumber: row.guest_number,
    status: displayTicketStatus(row.status, order?.status ?? ""),
    checkedIn: row.status === "checked-in",
    checkedInAt: row.checked_in_at,
    orderRef: orderRefFromId(row.order_id),
  };
}

function matchesRefund(status: string, refund: string) {
  if (!refund) return true;
  if (refund === "refunded") return status === "refunded";
  if (refund === "partial") return status === "partially-refunded";
  if (refund === "disputed") return status === "disputed";
  return status === "paid";
}

interface TicketJoin {
  id: string;
  tier_id: string;
  guest_number: number;
  status: string;
  checked_in_at: string | null;
  order_id: string;
  orders: { tier_name: string; status: string } | { tier_name: string; status: string }[] | null;
}

async function ticketDetail(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  const prefix = parseTicketRef(body.ref);
  if (!eventId || !prefix) return { error: "Ticket not found" };
  const ids = await idsWithPrefix("tickets", eventId, prefix);
  if (ids.length !== 1) return { error: "Ticket not found" };
  const { data, error } = await admin
    .from("tickets")
    .select("id, event_id, tier_id, guest_number, status, checked_in_at, order_id, orders!inner(id, tier_name, status, event_id, is_test)")
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("orders.is_test", false)
    .maybeSingle();
  if (error) throw error;
  const row = data as TicketJoin & { event_id: string } | null;
  if (!row || row.event_id !== eventId) return { error: "Ticket not found" };
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
  return {
    ticket: {
      ref: ticketRefFromId(row.id),
      tier: tiers.find((tier) => tier.tier_id === row.tier_id)?.name ?? order?.tier_name ?? row.tier_id,
      guestNumber: row.guest_number,
      status: displayTicketStatus(row.status, order?.status ?? ""),
      checkedIn: row.status === "checked-in",
      checkedInAt: row.checked_in_at,
      orderRef: orderRefFromId(row.order_id),
      eventName: eventProfile(tiers, null).name,
    },
  };
}

async function checkin(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const page = parsePage(body.page, body.pageSize);
  if (!page) return { error: "Bad filter" };
  const summary = await metrics(eventId);
  if ("error" in summary) return summary;
  const expected = summary.admissionsSold;
  const scans = await recentScans(eventId);
  const slice = scans.slice(page.from, page.to + 1);
  return {
    expected,
    checkedIn: summary.checkedIn,
    remaining: summary.guestsRemaining,
    cancelled: summary.cancelledPasses,
    percent: checkInPercent(summary.checkedIn, expected),
    scans: slice,
    page: page.page,
    pageSize: page.pageSize,
    total: scans.length,
  };
}

interface ScanOrder {
  tier_name: string;
  status: string;
  is_test: boolean;
}

async function recentScans(eventId: string) {
  const rows: {
    id: number;
    outcome: string;
    created_at: string;
    tickets: { id: string; event_id: string; guest_number: number; tier_id: string; orders: ScanOrder | ScanOrder[] | null } | null;
  }[] = [];
  for (let from = 0; from < 1000; from += 200) {
    const { data, error } = await admin
      .from("scans")
      .select("id, outcome, created_at, tickets(id, event_id, guest_number, tier_id, orders(tier_name, status, is_test))")
      .order("created_at", { ascending: false })
      .range(from, from + 199);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 200) break;
  }
  const orderOf = (row: (typeof rows)[number]) => (Array.isArray(row.tickets?.orders) ? row.tickets?.orders[0] : row.tickets?.orders);
  const matched = rows.filter((row) => (!row.tickets || row.tickets.event_id === eventId) && !orderOf(row)?.is_test);
  return matched.map((row) => {
    const order = orderOf(row);
    const sameEvent = row.tickets?.event_id === eventId;
    return {
      at: row.created_at,
      ref: sameEvent && row.tickets ? ticketRefFromId(row.tickets.id) : null,
      tier: sameEvent ? order?.tier_name ?? null : null,
      result: displayScanResult(row.outcome, sameEvent ? order?.status ?? "" : ""),
    };
  });
}

async function auditPage(body: Record<string, unknown>) {
  const page = parsePage(body.page, body.pageSize);
  if (!page) return { error: "Bad filter" };
  const [{ data, error, count }, staff] = await Promise.all([
    admin
      .from("audit_log")
      .select("created_at, actor_id, actor_role, action, resource_type, resource_id, summary", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page.from, page.to),
    admin.from("staff_roles").select("user_id, email, role"),
  ]);
  if (error) throw error;
  if (staff.error) throw staff.error;
  const people = new Map((staff.data ?? []).map((person) => [person.user_id, person.email as string]));
  return {
    entries: (data ?? []).map((entry) => ({
      at: entry.created_at,
      actor: entry.actor_id ? people.get(entry.actor_id) ?? entry.actor_role ?? "Staff" : "System",
      role: entry.actor_role,
      action: entry.action,
      resource: entry.resource_type,
      resourceRef: safeResource(entry.resource_type, entry.resource_id),
      summary: redactAudit(sanitizeAuditSummary(entry.summary ?? {})),
    })),
    page: page.page,
    pageSize: page.pageSize,
    total: count ?? 0,
  };
}

async function idsWithPrefix(table: "orders" | "tickets", eventId: string, prefix: string) {
  const matches: string[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const query = table === "orders"
      ? admin.from(table).select("id").eq("event_id", eventId).eq("is_test", false)
      : admin.from(table).select("id, orders!inner(is_test)").eq("event_id", eventId).eq("orders.is_test", false);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) {
      if (String(row.id).startsWith(prefix)) matches.push(row.id);
    }
    if (matches.length > 1 || !data || data.length < 1000) break;
  }
  return matches;
}

// Stage D does not call these. The checks stay in source so a later release
// still has to match a server-side event name and the order's own event.
async function cancelConfirm(body: Record<string, unknown>) {
  throw new Error("mutations_disabled");
  const eventId = String(body.eventId ?? "");
  const typed = String(body.confirmName ?? "").trim();
  const expected = EVENT_NAMES[eventId];
  if (!expected || typed !== expected) return { error: "Type the event name and a reason to cancel." };
  return { error: "This action is not available." };
}

async function refundOne(body: Record<string, unknown>) {
  throw new Error("mutations_disabled");
  const { data: order } = await admin.from("orders").select("event_id").limit(0).maybeSingle();
  if (!order || order.event_id !== String(body.eventId ?? "")) return { error: "Order not found." };
  return { error: "This action is not available." };
}

void cancelConfirm;
void refundOne;

async function audit(
  actor: { id: string; role: string } | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  summary: Record<string, unknown>,
  ip: string,
  ua: string,
  actorRole: string | null = null,
) {
  const role = actor?.role ?? actorRole;
  await admin.rpc("record_audit", {
    p_actor_id: actor?.id ?? null,
    p_actor_role: role === "super_admin" || role === "admin" || role === "door_staff" ? role : null,
    p_action: action,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_summary: redactAudit(sanitizeAuditSummary(summary)),
    p_ip: ip,
    p_user_agent: ua,
  });
}

async function allow(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("allow_request", {
    p_bucket: bucket.slice(0, 120),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  return rateLimitAllows(error, data);
}

function originOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  return origin === site || origin === site.replace("://", "://www.") || /^http:\/\/localhost:\d+$/.test(origin);
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim().slice(0, 64) || "unknown";
}
