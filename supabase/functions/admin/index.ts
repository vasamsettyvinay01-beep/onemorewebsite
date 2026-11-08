// Operations API. A caller must be a Supabase Auth user with a staff_roles role
// of admin or super_admin, and an authenticator session (aal2). The legacy door
// login is not an admin credential. Role is resolved here. A super admin can
// refund one paid order and assign staff. Cancellation stays rejected.

import Stripe from "npm:stripe@17";
import { admin, corsHeaders, json } from "../_shared/http.ts";
import { renderComplimentaryPreview, sendComplimentaryInvitation } from "../_shared/complimentary-delivery.ts";
import { sendOrderTicketEmail } from "../_shared/order-email.ts";
import {
  canAssignRole,
  permit,
  rateLimitAllows,
  rateLimitFor,
  requiresMfa,
  resolveRole,
  roleAuditAction,
  sanitizeAuditSummary,
} from "../_shared/staff-auth.mjs";
import {
  cleanSearch,
  dayKey,
  displayScanResult,
  displayTicketStatus,
  doorTotals,
  emailLabel,
  isBlockedAction,
  isLegacyDoorAccount,
  isOpenMutation,
  isReadAction,
  likePattern,
  orderRefFromId,
  parseCheckinFilter,
  parseComplimentaryCount,
  parseComplimentaryName,
  parseDay,
  cashReceivedPhraseOk,
  cashReturnedPhraseOk,
  complimentaryIssuanceStatus,
  complimentaryPassCounts,
  parseEventId,
  parseGuestNumber,
  parseIdempotencyKey,
  parseOrderRef,
  parsePage,
  parsePaymentMethod,
  parsePaymentStatus,
  parseRefundStatus,
  parseStaffEmail,
  parseStaffRole,
  parseTicketRef,
  parseTicketStatus,
  parseTierId,
  redactAudit,
  refundBlockReason,
  refundLabel,
  refundPhraseOk,
  safeResource,
  splitCharge,
  ticketCounts,
  ticketRefFromId,
  zoneForVenue,
} from "../_shared/admin-read.mjs";
import {
  eligibleTierIds,
  normalizePromoCode,
  parsePromoFilter,
  promoEligibilityMessage,
  promoLabel,
  promotionIsLive,
} from "../_shared/promo.mjs";
import { buildCartSnapshot, parseCartItems, priceCart, promoHasNoEligibleLine } from "../_shared/cart.mjs";
import { quoteCartTotal } from "../_shared/pricing.ts";
import {
  parseVipCapacity,
  parseVipCode,
  parseVipHostName,
  parseVipNote,
  parseVipPhone,
  parseVipTableLabel,
  revokePhraseOk,
  vipRemaining,
  vipStatusLabel,
  vipSummary,
} from "../_shared/vip.mjs";
import { renderVipPreview, sendVipInvitationEmail, vipPassUrl } from "../_shared/vip-delivery.ts";

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
  promo_code: string | null;
  discount_percent: number | null;
  original_subtotal_cents: number | null;
  discount_amount_cents: number | null;
  discounted_subtotal_cents: number | null;
  tax_cents: number | null;
  payment_method: string | null;
  cash_received_cents: number | null;
  paid_at: string | null;
  issued_by: string | null;
  cash_refunded_at: string | null;
  cash_refunded_by: string | null;
  cash_refund_cents: number | null;
}

const ORDER_COLUMNS =
  "id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, amount_total, currency, status, emailed_at, created_at, promo_code, discount_percent, original_subtotal_cents, discount_amount_cents, discounted_subtotal_cents, tax_cents, payment_method, cash_received_cents, paid_at, issued_by, cash_refunded_at, cash_refunded_by, cash_refund_cents";

// Orders fulfilled after promo codes shipped carry their own price snapshot.
// Older orders are split from the catalog price, as before.
function orderParts(
  order: Pick<OrderRow, "amount_total" | "quantity" | "discounted_subtotal_cents" | "tax_cents">,
  unitPrice: number | undefined,
) {
  if (order.discounted_subtotal_cents != null && order.tax_cents != null) {
    return { subtotal: order.discounted_subtotal_cents, tax: order.tax_cents, total: order.amount_total };
  }
  return unitPrice == null ? null : splitCharge(order.amount_total, unitPrice, order.quantity);
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
  if (!permit(actor.role, action) || (!isReadAction(action) && !isOpenMutation(action))) {
    return json(req, { error: "Not authorised" }, 403);
  }
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
        return asResult(req, await auditPage(actor, body));
      case "complimentary_list":
        return asResult(req, await complimentaryList(body));
      case "complimentary_view":
        return asResult(req, await complimentaryView(body));
      case "complimentary_preview":
        return asResult(req, await complimentaryPreview(body));
      case "revoke_complimentary_pass":
        return asResult(req, await revokeComplimentaryPass(actor, body, ip, ua));
      case "revoke_complimentary_issuance":
        return asResult(req, await revokeComplimentaryIssuance(actor, body, ip, ua));
      case "cash_quote":
        return asResult(req, await cashQuote(body));
      case "cash_issue":
        return asResult(req, await cashIssue(actor, body, ip, ua));
      case "cash_refund":
        return asResult(req, await cashRefund(actor, body, ip, ua));
      case "promo_report":
        return asResult(req, await promoReport(body));
      case "issue_complimentary":
        return asResult(req, await issueComplimentary(actor, body, ip, ua));
      case "resend_complimentary":
        return asResult(req, await resendComplimentary(actor, body, ip, ua));
      case "refund_preview":
        return asResult(req, await refundPreview(actor, body));
      case "refund_one":
        return asResult(req, await refundOrder(actor, body, ip, ua));
      case "staff_list":
        return asResult(req, await staffList(actor));
      case "staff_set":
        return asResult(req, await staffSet(actor, body, ip, ua));
      case "vip_list":
        return asResult(req, await vipList(body));
      case "vip_view":
        return asResult(req, await vipView(body));
      case "vip_preview":
        return asResult(req, await vipPreview(body));
      case "vip_issue":
        return asResult(req, await vipIssue(actor, body, ip, ua));
      case "vip_resend":
        return asResult(req, await vipResend(actor, body, ip, ua));
      case "vip_revoke":
        return asResult(req, await vipRevoke(actor, body, ip, ua));
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
  table: "orders" | "tickets" | "order_items",
  columns: string,
  eventId: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const query = table === "orders"
      ? admin.from(table).select(columns).eq("event_id", eventId).eq("is_test", false).eq("is_complimentary", false)
      : admin
        .from(table)
        .select(`${columns}, orders!inner(is_test, is_complimentary)`)
        .eq("event_id", eventId)
        .eq("orders.is_test", false)
        .eq("orders.is_complimentary", false);
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
  const [orders, tickets, holds, itemRows] = await Promise.all([
    scanRows<Pick<OrderRow, "id" | "tier_id" | "quantity" | "amount_total" | "currency" | "status" | "created_at" | "discounted_subtotal_cents" | "tax_cents" | "payment_method">>(
      "orders",
      "id, tier_id, quantity, amount_total, currency, status, created_at, discounted_subtotal_cents, tax_cents, payment_method",
      eventId,
    ),
    scanRows<{ id: string; tier_id: string; status: string; order_id: string }>(
      "tickets",
      "id, tier_id, status, order_id",
      eventId,
    ),
    holdMap(eventId),
    // Orders from mixed-ticket carts carry one row per ticket type. Older orders have none.
    scanRows<{ order_id: string; tier_id: string; quantity: number; total_admissions: number; line_total_cents: number }>(
      "order_items",
      "order_id, tier_id, quantity, total_admissions, line_total_cents",
      eventId,
    ),
  ]);
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  const price = new Map(tiers.map((tier) => [tier.tier_id, tier]));
  let gross = 0;
  let subtotal = 0;
  let tax = 0;
  let refunded = 0;
  let cardSales = 0;
  let cashSales = 0;
  let split = true;
  const soldUnits = new Map<string, number>();
  const refundedUnits = new Map<string, number>();
  const revenue = new Map<string, number>();
  const days = new Map<string, { orders: number; charged: number; refunded: number; issued: number }>();
  for (const order of orders) {
    gross += order.amount_total;
    const lines = itemsByOrder.get(order.id);
    const tier = price.get(order.tier_id);
    const parts = orderParts(order, tier?.price_cents);
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
      bucket.issued += lines
        ? lines.reduce((sum, line) => sum + line.total_admissions, 0)
        : order.quantity * Math.max(tier?.admits ?? 1, 1);
      if (order.status === "refunded") bucket.refunded += order.amount_total;
      days.set(day, bucket);
    }
    // Per ticket type: a mixed-ticket order contributes each of its lines; an older order its one tier.
    const contributions = lines
      ? lines.map((line) => ({ tierId: line.tier_id, units: line.quantity, charged: line.line_total_cents }))
      : [{ tierId: order.tier_id, units: order.quantity, charged: order.amount_total }];
    if (order.status === "refunded") {
      refunded += order.amount_total;
      for (const part of contributions) refundedUnits.set(part.tierId, (refundedUnits.get(part.tierId) ?? 0) + part.units);
    } else {
      if (order.payment_method === "cash") cashSales += order.amount_total;
      else cardSales += order.amount_total;
      for (const part of contributions) {
        soldUnits.set(part.tierId, (soldUnits.get(part.tierId) ?? 0) + part.units);
        revenue.set(part.tierId, (revenue.get(part.tierId) ?? 0) + part.charged);
      }
    }
  }
  const issued = new Map<string, number>();
  const live = new Map<string, number>();
  for (const ticket of tickets) {
    issued.set(ticket.tier_id, (issued.get(ticket.tier_id) ?? 0) + 1);
    if (ticket.status !== "cancelled" && ticket.status !== "revoked") live.set(ticket.tier_id, (live.get(ticket.tier_id) ?? 0) + 1);
  }
  const admissions = ticketCounts(tickets);
  const cancelled = admissions.cancelled;
  const checkedIn = admissions.checkedIn;
  const activeAdmissions = admissions.expected;
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
    cardSales,
    cashSales,
    paidSales: cardSales + cashSales,
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
  const [{ data, error }, door] = await Promise.all([
    admin
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("event_id", eventId)
      .eq("is_test", false)
      .eq("is_complimentary", false)
      .order("created_at", { ascending: false })
      .limit(8),
    doorAdmissions(eventId, summary),
  ]);
  if (error) throw error;
  const recent = await presentOrders((data ?? []) as OrderRow[], summary.tiers, summary.event.name);
  return {
    ...summary,
    checkedIn: door.checkedIn,
    guestsRemaining: door.remaining,
    complimentaryCheckedIn: door.complimentary.checkedIn,
    complimentaryRemaining: door.complimentary.remaining,
    recentOrders: recent,
  };
}

interface PromotionRow {
  id: string;
  code: string;
  event_id: string;
  discount_type: string;
  discount_value: number;
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
}

async function loadPromotions(eventId?: string): Promise<PromotionRow[]> {
  let query = admin
    .from("promotions")
    .select("id, code, event_id, discount_type, discount_value, active, starts_at, expires_at, created_at")
    .order("created_at");
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PromotionRow[];
}

async function events() {
  const [tiers, promotions] = await Promise.all([loadTiers(), loadPromotions()]);
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
        remaining: tier.remaining,
        soldOut: tier.status === "Sold out",
        active: tier.status !== "Inactive",
      })),
      promoCodes: promotions.filter((promo) => promo.event_id === id).map((promo) => promo.code),
    });
  }
  return { events: list };
}

// Super admin promo attribution. Reads only the snapshot stored on each order,
// never the current promotion settings, so history stays correct if a code changes.
// "Current" figures leave out fully refunded and disputed orders; gross keeps every order.
async function promoReport(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const promotions = await loadPromotions(eventId);
  const report = [];
  for (const promotion of promotions) {
    const orders: OrderRow[] = [];
    for (let from = 0; from < 20000; from += 500) {
      const { data, error } = await admin
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("event_id", eventId)
        .eq("promotion_id", promotion.id)
        .eq("is_test", false)
        .eq("is_complimentary", false)
        .order("created_at", { ascending: false })
        .range(from, from + 499);
      if (error) throw error;
      orders.push(...((data ?? []) as OrderRow[]));
      if (!data || data.length < 500) break;
    }
    const orderIds = orders.map((order) => order.id);
    const counts = await promoAdmissionCounts(orderIds);
    const itemsByOrder = await loadOrderItems(orderIds);
    // admissions*: passes on the lines the code actually discounted (all passes of an older order,
    // which was priced as one discounted line). orderAdmissions*: every pass in an order that used the code,
    // so a Couple or Group in the same cart is visible but is not counted as a discounted admission.
    const summary = {
      orders: orders.length,
      currentOrders: 0,
      refundedOrders: 0,
      disputedOrders: 0,
      admissionsActive: 0,
      admissionsIssued: 0,
      orderAdmissionsActive: 0,
      orderAdmissionsIssued: 0,
      originalValue: 0,
      discounts: 0,
      netSubtotal: 0,
      tax: 0,
      totalPaid: 0,
      grossSales: 0,
      refunds: 0,
      disputed: 0,
      netRevenue: 0,
    };
    for (const order of orders) {
      const tickets = counts.get(order.id) ?? { issued: 0, active: 0, eligibleIssued: 0, eligibleActive: 0 };
      summary.admissionsIssued += tickets.eligibleIssued;
      summary.admissionsActive += tickets.eligibleActive;
      summary.orderAdmissionsIssued += tickets.issued;
      summary.orderAdmissionsActive += tickets.active;
      summary.grossSales += order.amount_total;
      if (order.status === "refunded") {
        summary.refundedOrders += 1;
        summary.refunds += order.amount_total;
        continue;
      }
      if (order.status === "disputed") {
        summary.disputedOrders += 1;
        summary.disputed += order.amount_total;
        continue;
      }
      summary.currentOrders += 1;
      summary.originalValue += order.original_subtotal_cents ?? 0;
      summary.discounts += order.discount_amount_cents ?? 0;
      summary.netSubtotal += order.discounted_subtotal_cents ?? 0;
      summary.tax += order.tax_cents ?? 0;
      summary.totalPaid += order.amount_total;
    }
    summary.netRevenue = summary.grossSales - summary.refunds - summary.disputed;
    report.push({
      code: promotion.code,
      discountType: promotion.discount_type,
      discountValue: promotion.discount_value,
      active: promotion.active,
      startsAt: promotion.starts_at,
      expiresAt: promotion.expires_at,
      currency: orders[0]?.currency ?? "usd",
      summary,
      orders: orders.map((order) => ({
        ref: orderRefFromId(order.id),
        purchaser: order.purchaser_name,
        email: order.purchaser_email,
        tier: order.tier_name,
        items: presentItems(itemsByOrder.get(order.id)),
        units: order.quantity,
        admissions: counts.get(order.id)?.issued ?? 0,
        discountedAdmissions: counts.get(order.id)?.eligibleIssued ?? 0,
        promoCode: order.promo_code,
        discountPercent: order.discount_percent,
        originalSubtotal: order.original_subtotal_cents,
        discount: order.discount_amount_cents,
        subtotal: order.discounted_subtotal_cents,
        tax: order.tax_cents,
        total: order.amount_total,
        currency: order.currency,
        paymentStatus: order.status,
        refundStatus: refundLabel(order.status),
        createdAt: order.created_at,
      })),
    });
  }
  return { promotions: report };
}

async function sales(eventId: string) {
  if (!eventId) return { error: "eventId required" };
  const summary = await metrics(eventId);
  if ("error" in summary) return summary;
  return { currency: summary.currency, timeline: summary.timeline, tiers: summary.tiers };
}

interface OrderItemRow {
  order_id: string;
  position: number;
  tier_id: string;
  display_name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  total_admissions: number;
  original_line_subtotal_cents: number;
  promo_eligible: boolean;
  eligible_discount_cents: number;
  discounted_line_subtotal_cents: number;
  tax_cents: number;
  line_total_cents: number;
}

const ORDER_ITEM_COLUMNS =
  "order_id, position, tier_id, display_name_snapshot, unit_price_cents, quantity, total_admissions, original_line_subtotal_cents, promo_eligible, eligible_discount_cents, discounted_line_subtotal_cents, tax_cents, line_total_cents";

// The frozen line snapshot of mixed-ticket orders. Older orders have none and are absent from the map.
async function loadOrderItems(orderIds: string[]) {
  const byOrder = new Map<string, OrderItemRow[]>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data, error } = await admin.from("order_items").select(ORDER_ITEM_COLUMNS).in("order_id", orderIds.slice(i, i + 200));
    if (error) throw error;
    for (const item of (data ?? []) as OrderItemRow[]) byOrder.set(item.order_id, [...(byOrder.get(item.order_id) ?? []), item]);
  }
  for (const list of byOrder.values()) list.sort((a, b) => a.position - b.position);
  return byOrder;
}

function presentItems(items: OrderItemRow[] | undefined) {
  return (items ?? []).map((item) => ({
    tierId: item.tier_id,
    name: item.display_name_snapshot,
    unitPrice: item.unit_price_cents,
    quantity: item.quantity,
    admissions: item.total_admissions,
    lineSubtotal: item.original_line_subtotal_cents,
    promoEligible: item.promo_eligible,
    discount: item.eligible_discount_cents,
    discountedSubtotal: item.discounted_line_subtotal_cents,
    tax: item.tax_cents,
    lineTotal: item.line_total_cents,
  }));
}

function presentOrder(
  order: OrderRow,
  admissions: number,
  parts: { subtotal: number; tax: number; total: number } | null,
  eventName: string,
  items?: OrderItemRow[],
) {
  return {
    items: presentItems(items),
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
    paymentMethod: order.payment_method === "cash" ? "cash" : "card",
    cashReceived: order.cash_received_cents,
    paidAt: order.paid_at,
    issuedBy: order.issued_by,
    cashRefundedAt: order.cash_refunded_at,
    cashRefundedBy: order.cash_refunded_by,
    cashRefundCents: order.cash_refund_cents,
    refundStatus: refundLabel(order.status),
    emailStatus: emailLabel(order.emailed_at),
    createdAt: order.created_at,
    promoCode: order.promo_code,
    promoLabel: promoLabel(order.promo_code, order.discount_percent) || null,
    discountPercent: order.discount_percent,
    originalSubtotal: order.original_subtotal_cents ?? (parts && !order.promo_code ? parts.subtotal : null),
    discount: order.discount_amount_cents ?? (parts && !order.promo_code ? 0 : null),
  };
}

async function presentOrders(orders: OrderRow[], tiers: { id: string; priceCents: number }[], eventName: string) {
  if (!orders.length) return [];
  const prices = new Map(tiers.map((tier) => [tier.id, tier.priceCents]));
  const counts = await admissionCounts(orders.map((order) => order.id));
  const items = await loadOrderItems(orders.map((order) => order.id));
  return orders.map((order) =>
    presentOrder(order, counts.get(order.id)?.issued ?? 0, orderParts(order, prices.get(order.tier_id)), eventName, items.get(order.id))
  );
}

// Pass counts per order, split by whether each pass sits on a promo-discounted line.
async function promoAdmissionCounts(orderIds: string[]) {
  const items = await loadOrderItems(orderIds);
  const counts = new Map<string, { issued: number; active: number; eligibleIssued: number; eligibleActive: number }>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data, error } = await admin.from("tickets").select("order_id, tier_id, status").in("order_id", orderIds.slice(i, i + 200));
    if (error) throw error;
    for (const ticket of data ?? []) {
      const entry = counts.get(ticket.order_id) ?? { issued: 0, active: 0, eligibleIssued: 0, eligibleActive: 0 };
      const lines = items.get(ticket.order_id);
      const eligible = !lines || lines.some((line) => line.tier_id === ticket.tier_id && line.promo_eligible);
      entry.issued += 1;
      if (eligible) entry.eligibleIssued += 1;
      if (ticket.status !== "cancelled" && ticket.status !== "revoked") {
        entry.active += 1;
        if (eligible) entry.eligibleActive += 1;
      }
      counts.set(ticket.order_id, entry);
    }
  }
  return counts;
}

async function admissionCounts(orderIds: string[]) {
  const counts = new Map<string, { issued: number; active: number }>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data, error } = await admin.from("tickets").select("order_id, status").in("order_id", orderIds.slice(i, i + 200));
    if (error) throw error;
    for (const ticket of data ?? []) {
      const entry = counts.get(ticket.order_id) ?? { issued: 0, active: 0 };
      entry.issued += 1;
      if (ticket.status !== "cancelled" && ticket.status !== "revoked") entry.active += 1;
      counts.set(ticket.order_id, entry);
    }
  }
  return counts;
}

// Order ids whose mixed-ticket cart includes a ticket type. Both inputs are validated: the tier id by
// parseTierId, the order ids are database uuids, so they are safe inside a PostgREST filter list.
async function orderIdsWithTier(eventId: string, tierId: string): Promise<string[]> {
  const { data, error } = await admin.from("order_items").select("order_id").eq("event_id", eventId).eq("tier_id", tierId).limit(5000);
  if (error) throw error;
  return [...new Set<string>((data ?? []).map((row: { order_id: string }) => row.order_id))];
}

async function listOrders(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const page = parsePage(body.page, body.pageSize);
  const query = cleanSearch(body.q);
  const payment = parsePaymentStatus(body.paymentStatus);
  const method = parsePaymentMethod(body.paymentMethod);
  const refund = parseRefundStatus(body.refundStatus);
  const tierId = parseTierId(body.tierId);
  const fromDay = parseDay(body.from);
  const toDay = parseDay(body.to);
  const promo = parsePromoFilter(body.promo);
  if (!page || query === null || payment === null || method === null || refund === null || tierId === null || fromDay === null || toDay === null || promo === null) {
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
      .select(ORDER_COLUMNS)
      .eq("id", ids[0])
      .eq("event_id", eventId)
      .eq("is_test", false)
      .eq("is_complimentary", false)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    const order = data as OrderRow;
    if (payment && order.status !== payment) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (method && order.payment_method !== method) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (!matchesRefund(order.status, refund)) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (tierId && order.tier_id !== tierId && !(await orderIdsWithTier(eventId, tierId)).includes(order.id)) {
      return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    }
    if (promo === "none" ? order.promo_code != null : promo && order.promo_code !== promo) {
      return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    }
    const created = order.created_at.slice(0, 10);
    if (fromDay && created < fromDay) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    if (toDay && created > toDay) return { orders: [], page: 1, pageSize: page.pageSize, total: 0 };
    return { orders: await presentOrders([order], tiers, profile.name), page: 1, pageSize: page.pageSize, total: 1, eventName: profile.name };
  }

  let request = admin
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .eq("event_id", eventId)
    .eq("is_test", false)
    .eq("is_complimentary", false)
    .order("created_at", { ascending: false });
  if (payment) request = request.eq("status", payment);
  if (method) request = request.eq("payment_method", method);
  if (refund === "refunded") request = request.eq("status", "refunded");
  if (refund === "partial") request = request.eq("status", "partially-refunded");
  if (refund === "disputed") request = request.eq("status", "disputed");
  if (refund === "none") request = request.eq("status", "paid");
  if (tierId) {
    // A tier filter also finds mixed-ticket orders that include the tier on any line.
    const mixed = await orderIdsWithTier(eventId, tierId);
    request = mixed.length ? request.or(`tier_id.eq.${tierId},id.in.(${mixed.join(",")})`) : request.eq("tier_id", tierId);
  }
  if (promo === "none") request = request.is("promo_code", null);
  else if (promo) request = request.eq("promo_code", promo);
  if (fromDay) request = request.gte("created_at", `${fromDay}T00:00:00.000Z`);
  if (toDay) request = request.lte("created_at", `${toDay}T23:59:59.999Z`);
  if (query) {
    const pattern = likePattern(query);
    request = request.or(`purchaser_name.ilike."${pattern}",purchaser_email.ilike."${pattern}",promo_code.ilike."${pattern}"`);
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
    .select(ORDER_COLUMNS)
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("is_test", false)
    .eq("is_complimentary", false)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.event_id !== eventId) return { error: "Order not found" };
  const order = data as OrderRow;
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === eventId);
  const tier = tiers.find((item) => item.tier_id === order.tier_id);
  const { data: tickets, error: ticketError } = await admin
    .from("tickets")
    .select("id, guest_number, tier_id, status, checked_in_at")
    .eq("order_id", order.id)
    .eq("event_id", eventId)
    .order("guest_number");
  if (ticketError) throw ticketError;
  const [presented] = await presentOrders([order], tiers, eventProfile(tiers, null).name);
  if (presented.paymentMethod === "cash") {
    const ids = [order.issued_by, order.cash_refunded_by].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const { data: staff, error: staffError } = await admin.from("staff_roles").select("user_id, email").in("user_id", ids);
      if (staffError) throw staffError;
      const names = new Map((staff ?? []).map((person) => [person.user_id, person.email]));
      presented.issuedBy = order.issued_by ? names.get(order.issued_by) ?? "Super admin" : null;
      presented.cashRefundedBy = order.cash_refunded_by ? names.get(order.cash_refunded_by) ?? "Super admin" : null;
    }
  }
  return {
    order: { ...presented, eventName: eventProfile(tiers, null).name },
    tickets: (tickets ?? []).map((ticket) => ({
      ref: ticketRefFromId(ticket.id),
      guestNumber: ticket.guest_number,
      tier: tiers.find((item) => item.tier_id === ticket.tier_id)?.name ?? order.tier_name,
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
    .select("id, event_id, tier_id, guest_number, status, checked_in_at, order_id, orders!inner(id, tier_name, status, event_id, is_test, is_complimentary)", { count: "exact" })
    .eq("event_id", eventId)
    .eq("orders.is_test", false)
    .eq("orders.is_complimentary", false)
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
    .select("id, event_id, tier_id, guest_number, status, checked_in_at, order_id, orders!inner(id, tier_name, status, event_id, is_test, is_complimentary)")
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("orders.is_test", false)
    .eq("orders.is_complimentary", false)
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
  const [door, scans] = await Promise.all([doorAdmissions(eventId, summary), recentScans(eventId)]);
  const slice = scans.slice(page.from, page.to + 1);
  return {
    ...door,
    scans: slice,
    page: page.page,
    pageSize: page.pageSize,
    total: scans.length,
  };
}

// Sales metrics leave complimentary passes out; the door admits them, so door counts include them.
async function doorAdmissions(
  eventId: string,
  summary: { admissionsSold: number; checkedIn: number; guestsRemaining: number; cancelledPasses: number },
) {
  const comp = await complimentaryMetrics(eventId);
  const paid = {
    expected: summary.admissionsSold,
    checkedIn: summary.checkedIn,
    remaining: summary.guestsRemaining,
    cancelled: summary.cancelledPasses,
  };
  const complimentary = { expected: comp.admitted + comp.remaining, checkedIn: comp.admitted, remaining: comp.remaining, cancelled: comp.revoked };
  return { ...doorTotals(paid, complimentary), paid, complimentary };
}

interface ScanOrder {
  tier_name: string;
  status: string;
  is_test: boolean;
  is_complimentary: boolean;
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
      .select("id, outcome, created_at, tickets(id, event_id, guest_number, tier_id, orders(tier_name, status, is_test, is_complimentary))")
      .order("created_at", { ascending: false })
      .range(from, from + 199);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 200) break;
  }
  const orderOf = (row: (typeof rows)[number]) => (Array.isArray(row.tickets?.orders) ? row.tickets?.orders[0] : row.tickets?.orders);
  const tierNames = new Map(
    (await loadTiers()).filter((tier) => tier.event_id === eventId).map((tier) => [tier.tier_id, tier.name]),
  );
  const matched = rows.filter((row) =>
    (!row.tickets || row.tickets.event_id === eventId)
    && !orderOf(row)?.is_test
  );
  return matched.map((row) => {
    const order = orderOf(row);
    const sameEvent = row.tickets?.event_id === eventId;
    return {
      at: row.created_at,
      ref: sameEvent && row.tickets ? ticketRefFromId(row.tickets.id) : null,
      tier: sameEvent ? (row.tickets ? tierNames.get(row.tickets.tier_id) : undefined) ?? order?.tier_name ?? null : null,
      result: displayScanResult(row.outcome, sameEvent ? order?.status ?? "" : ""),
    };
  });
}

async function auditPage(actor: Actor, body: Record<string, unknown>) {
  const page = parsePage(body.page, body.pageSize);
  if (!page) return { error: "Bad filter" };
  let entries = admin
    .from("audit_log")
    .select("created_at, actor_id, actor_role, action, resource_type, resource_id, summary", { count: "exact" })
    .order("created_at", { ascending: false });
  if (actor.role !== "super_admin") {
    entries = entries
      .not(
        "action",
        "in",
        "(COMPLIMENTARY_PASSES_ISSUED,COMPLIMENTARY_EMAIL_RESENT,COMPLIMENTARY_EMAIL_FAILED)",
      )
      .not("action", "like", "VIP_%");
  }
  const [{ data, error, count }, staff] = await Promise.all([
    entries.range(page.from, page.to),
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
      ? admin.from(table).select("id").eq("event_id", eventId).eq("is_test", false).eq("is_complimentary", false)
      : admin
        .from(table)
        .select("id, orders!inner(is_test, is_complimentary)")
        .eq("event_id", eventId)
        .eq("orders.is_test", false)
        .eq("orders.is_complimentary", false);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) {
      if (String(row.id).startsWith(prefix)) matches.push(row.id);
    }
    if (matches.length > 1 || !data || data.length < 1000) break;
  }
  return matches;
}

interface ComplimentaryOrder {
  id: string;
  event_id: string;
  tier_id: string;
  tier_name: string;
  quantity: number;
  purchaser_name: string | null;
  purchaser_email: string;
  issued_by: string | null;
  emailed_at: string | null;
  created_at: string;
  tickets: { status: string }[];
}

async function complimentaryList(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const page = parsePage(body.page, body.pageSize);
  if (!page) return { error: "Bad filter" };

  const [{ data, error, count }, metrics] = await Promise.all([
    admin
      .from("orders")
      .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, issued_by, emailed_at, created_at, tickets(status)", { count: "exact" })
      .eq("event_id", eventId)
      .eq("is_test", false)
      .eq("is_complimentary", true)
      .order("created_at", { ascending: false })
      .range(page.from, page.to),
    complimentaryMetrics(eventId),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as ComplimentaryOrder[];
  const issuers = [...new Set(rows.map((order) => order.issued_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (issuers.length) {
    const { data: staff, error: staffError } = await admin.from("staff_roles").select("user_id, email").in("user_id", issuers);
    if (staffError) throw staffError;
    for (const person of staff ?? []) names.set(person.user_id, person.email);
  }
  return {
    entries: rows.map((order) => {
      const counts = complimentaryPassCounts(order.tickets ?? []);
      return {
        ref: orderRefFromId(order.id),
        name: order.purchaser_name,
        email: order.purchaser_email,
        issued: counts.issued,
        used: counts.used,
        remaining: counts.remaining,
        revoked: counts.revoked,
        status: complimentaryIssuanceStatus(order.tickets ?? []),
        emailStatus: emailLabel(order.emailed_at),
        createdAt: order.created_at,
        issuedBy: order.issued_by ? names.get(order.issued_by) ?? "Super admin" : null,
      };
    }),
    ...metrics,
    page: page.page,
    pageSize: page.pageSize,
    total: count ?? 0,
  };
}

async function complimentaryMetrics(eventId: string): Promise<{ issued: number; admitted: number; remaining: number; revoked: number }> {
  const metrics = { issued: 0, admitted: 0, remaining: 0, revoked: 0 };
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from("tickets")
      .select("status, orders!inner(is_test, is_complimentary)")
      .eq("event_id", eventId)
      .eq("orders.is_complimentary", true)
      .eq("orders.is_test", false)
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      metrics.issued += 1;
      if (row.status === "checked-in") metrics.admitted += 1;
      if (row.status === "valid") metrics.remaining += 1;
      if (row.status === "revoked") metrics.revoked += 1;
    }
    if (!data || data.length < 1000) break;
  }
  return metrics;
}

async function complimentaryPreview(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  const name = parseComplimentaryName(body.name);
  const ticketCount = parseComplimentaryCount(body.ticketCount);
  if (!eventId || !name || !ticketCount) return { error: "Enter a name and a ticket count from 1 to 10." };
  const email = await renderComplimentaryPreview({ hostName: name, count: ticketCount }, eventId);
  if (!email) return { error: "This event is not ready to preview." };
  return { subject: email.subject, html: email.html };
}

async function issueComplimentary(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const name = parseComplimentaryName(body.name);
  const email = parseStaffEmail(body.email);
  const phone = parseVipPhone(body.phone);
  const ticketCount = parseComplimentaryCount(body.ticketCount);
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!eventId || !name || !email || phone == null || !ticketCount || !idempotencyKey) {
    return { error: "A valid event, name, email, and ticket count from 1 to 10 are required." };
  }

  const { data, error } = await admin.rpc("issue_complimentary_tickets", {
    p_event_id: eventId,
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_ticket_count: ticketCount,
    p_idempotency_key: idempotencyKey,
    p_issued_by: actor.id,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string | null; outcome: string } | null;
  if (row?.outcome === "idempotency_mismatch") return { error: "This send request was already used with different details." };
  if (!row?.order_id || row.outcome === "rejected") return { error: "Complimentary tickets could not be created." };

  if (row.outcome === "created") {
    await audit(actor, "COMPLIMENTARY_PASSES_ISSUED", "order", row.order_id, {
      ref: orderRefFromId(row.order_id),
      email,
      ticket_count: ticketCount,
    }, ip, ua);
  }

  const delivery = await deliverComplimentary(row.order_id);
  if (delivery.error) {
    await audit(actor, "COMPLIMENTARY_EMAIL_FAILED", "order", row.order_id, {
      ref: orderRefFromId(row.order_id),
      ticket_count: ticketCount,
    }, ip, ua);
  }
  return {
    ok: !delivery.error,
    created: row.outcome === "created",
    ref: orderRefFromId(row.order_id),
    emailStatus: delivery.error ? "Not sent" : "Sent",
    message: delivery.error
      ? "The tickets were created, but the email was not sent. Use Retry email from the history below."
      : `${ticketCount} complimentary ${ticketCount === 1 ? "ticket was" : "tickets were"} sent to ${email}.`,
  };
}

async function resendComplimentary(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  if (!eventId || !prefix) return { error: "Complimentary order not found." };
  const order = await loadComplimentaryOrder(eventId, prefix);
  if (!order) return { error: "Complimentary order not found." };

  const valid = complimentaryPassCounts(order.tickets ?? []).remaining;
  if (valid === 0) {
    return { ok: false, ref: orderRefFromId(order.id), emailStatus: emailLabel(order.emailed_at), message: "This invitation has no valid remaining passes." };
  }
  const delivery = await deliverComplimentary(order.id, true);
  if (delivery.error) {
    await audit(actor, "COMPLIMENTARY_EMAIL_FAILED", "order", order.id, {
      ref: orderRefFromId(order.id),
      ticket_count: valid,
    }, ip, ua);
    return { ok: false, ref: orderRefFromId(order.id), emailStatus: "Not sent", message: "The email could not be sent. Try again." };
  }
  await audit(actor, "COMPLIMENTARY_EMAIL_RESENT", "order", order.id, {
    ref: orderRefFromId(order.id),
    ticket_count: valid,
  }, ip, ua);
  return { ok: true, ref: orderRefFromId(order.id), emailStatus: "Sent", message: `The ${valid} valid ${valid === 1 ? "pass was" : "passes were"} sent to ${order.purchaser_email}.` };
}

async function deliverComplimentary(orderId: string, force = false) {
  try {
    const result = await sendComplimentaryInvitation(orderId, { force });
    if (result === "not_sendable" || result === "none_valid") return { result, error: result };
    return { result, error: null };
  } catch (err) {
    console.error(JSON.stringify({
      msg: "complimentary_email_failed",
      orderId,
      error: (err as Error).message?.slice(0, 240),
    }));
    return { result: null, error: "email_failed" };
  }
}

async function loadComplimentaryOrder(eventId: string, prefix: string): Promise<ComplimentaryOrder | null> {
  const matches: ComplimentaryOrder[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from("orders")
      .select("id, event_id, tier_id, tier_name, quantity, purchaser_name, purchaser_email, issued_by, emailed_at, created_at, tickets(status)")
      .eq("event_id", eventId)
      .eq("is_test", false)
      .eq("is_complimentary", true)
      .range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as ComplimentaryOrder[]) {
      if (String(row.id).replace(/-/g, "").startsWith(prefix)) matches.push(row);
    }
    if (matches.length > 1 || !data || data.length < 1000) break;
  }
  return matches.length === 1 ? matches[0] : null;
}

interface RefundRow {
  id: string;
  event_id: string;
  tier_name: string;
  purchaser_name: string | null;
  purchaser_email: string;
  amount_total: number;
  currency: string;
  status: string;
  stripe_payment_intent: string | null;
  is_test: boolean;
}

async function loadRefundOrder(eventId: string, ref: string | null): Promise<RefundRow | null> {
  if (!ref) return null;
  const ids = await idsWithPrefix("orders", eventId, ref);
  if (ids.length !== 1) return null;
  const { data, error } = await admin
    .from("orders")
    .select("id, event_id, tier_name, purchaser_name, purchaser_email, amount_total, currency, status, stripe_payment_intent, is_test")
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("is_test", false)
    .eq("is_complimentary", false)
    .maybeSingle();
  if (error) throw error;
  return (data as RefundRow | null) ?? null;
}

async function refundPreview(actor: Actor, body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const order = await loadRefundOrder(eventId, parseOrderRef(body.ref));
  if (!order || order.event_id !== String(body.eventId ?? "")) return { error: "Order not found" };
  const ops = await eventOps(eventId);
  const { data: tickets, error } = await admin.from("tickets").select("status").eq("order_id", order.id).eq("event_id", eventId);
  if (error) throw error;
  const rows = tickets ?? [];
  const reason = refundBlockReason({
    role: actor.role,
    eventStatus: ops?.status ?? "open",
    orderStatus: order.status,
    charged: Boolean(order.stripe_payment_intent),
  });
  return {
    ref: orderRefFromId(order.id),
    purchaser: order.purchaser_name,
    email: order.purchaser_email,
    tier: order.tier_name,
    total: order.amount_total,
    currency: order.currency,
    passes: rows.length,
    checkedIn: rows.filter((ticket) => ticket.status === "checked-in").length,
    refundable: reason == null,
    reason,
  };
}

async function refundOrder(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const order = await loadRefundOrder(eventId, parseOrderRef(body.ref));
  if (!order || order.event_id !== String(body.eventId ?? "")) return { error: "Order not found" };
  if (!refundPhraseOk(body.confirm)) return { error: "Type REFUND to confirm." };
  const ops = await eventOps(eventId);
  const reason = refundBlockReason({
    role: actor.role,
    eventStatus: ops?.status ?? "open",
    orderStatus: order.status,
    charged: Boolean(order.stripe_payment_intent),
  });
  if (reason) return { error: reason };
  const paymentIntent = order.stripe_payment_intent;
  if (!paymentIntent) return { error: "This order has no card charge to refund." };
  const stripeError = await createCardRefund(paymentIntent, order.id);
  if (stripeError) return { error: stripeError };
  const { error } = await admin.rpc("cancel_order_by_payment_intent", {
    p_payment_intent: paymentIntent,
    p_full: true,
  });
  if (error) return { error: "The card was refunded, but the pass was not updated. Try again." };
  await audit(actor, "ORDER_REFUNDED", "order", order.id, {
    ref: orderRefFromId(order.id),
    amount_total: order.amount_total,
    currency: order.currency,
  }, ip, ua);
  return { ok: true, ref: orderRefFromId(order.id), status: "refunded" };
}

async function createCardRefund(paymentIntent: string, orderId: string): Promise<string | null> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return "Refunds are not configured.";
  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  try {
    await stripe.refunds.create({ payment_intent: paymentIntent }, { idempotencyKey: `omc-admin-refund-${orderId}` });
    return null;
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/already been refunded|charge_already_refunded/i.test(message)) return null;
    console.error(JSON.stringify({ msg: "admin_refund_failed", error: message.slice(0, 200) }));
    return "The card refund did not go through.";
  }
}

async function staffList(actor: Actor) {
  const { data, error } = await admin.from("staff_roles").select("email, role").order("email");
  if (error) throw error;
  return {
    staff: (data ?? []).map((person) => ({
      email: person.email as string,
      role: person.role as string,
      you: String(person.email).toLowerCase() === actor.email,
    })),
  };
}

async function staffSet(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const email = parseStaffEmail(body.email);
  const nextRole = parseStaffRole(body.staffRole);
  if (!email || !nextRole) return { error: "A valid email and role are required." };
  if (isLegacyDoorAccount(email, Deno.env.get("DOOR_EMAILS") ?? "")) return { error: "That account stays on the scanner only." };
  if (email === actor.email) return { error: "You cannot change your own role." };
  if (nextRole === "remove") return removeStaff(actor, email, ip, ua);

  let user = await authUserByEmail(email);
  let invited = false;
  if (!user) {
    const created = await inviteStaff(email);
    if (typeof created === "string") return { error: created };
    user = created;
    invited = true;
  }
  const [{ data: existing, error: existingError }, { count, error: countError }] = await Promise.all([
    admin.from("staff_roles").select("user_id, role").eq("user_id", user.id).maybeSingle(),
    admin.from("staff_roles").select("user_id", { count: "exact", head: true }).eq("role", "super_admin"),
  ]);
  if (existingError || countError) throw existingError ?? countError;
  const denied = canAssignRole({
    actorId: actor.id,
    actorRole: actor.role,
    targetId: user.id,
    currentRole: existing?.role ?? null,
    nextRole,
    superAdminCount: count ?? 0,
  });
  if (denied) return { error: denied };
  const saved = await admin.from("staff_roles").upsert({ user_id: user.id, email, role: nextRole }, { onConflict: "user_id" });
  if (saved.error) return { error: "That email is already assigned." };
  await audit(actor, roleAuditAction(existing?.role ?? null), "staff", user.id, { email, role: nextRole }, ip, ua);
  return { ok: true, email, role: nextRole, invited };
}

async function removeStaff(actor: Actor, email: string, ip: string, ua: string) {
  const { data, error } = await admin.from("staff_roles").select("user_id, role").eq("email", email).maybeSingle();
  if (error) throw error;
  if (!data) return { error: "That person has no staff role." };
  if (data.user_id === actor.id) return { error: "You cannot change your own role." };
  if (data.role === "super_admin") return { error: "A super admin role cannot be changed here." };
  const removed = await admin.from("staff_roles").delete().eq("user_id", data.user_id).neq("role", "super_admin");
  if (removed.error) throw removed.error;
  await audit(actor, "STAFF_ROLE_REMOVED", "staff", data.user_id, { email, role: data.role }, ip, ua);
  return { ok: true, email, role: "remove" };
}

async function authUserByEmail(email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found?.id) return { id: found.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

async function inviteStaff(email: string): Promise<{ id: string } | string> {
  const site = (Deno.env.get("SITE_URL") || "https://theonemorecompany.com").replace(/\/$/, "");
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/setup`,
  });
  if (error || !data.user?.id) {
    const again = await authUserByEmail(email);
    if (again) return again;
    return "Could not invite that email.";
  }
  return { id: data.user.id };
}

// Private VIP invitations. Super admin only (see PERMISSIONS). Separate from
// orders, tickets, tiers, promotions, and Stripe. Capacity 1–6 is checked here,
// in the issue RPC, and by a table constraint.
interface VipRow {
  id: string;
  event_id: string;
  table_label: string;
  host_name: string;
  email: string;
  phone: string | null;
  admin_note: string | null;
  capacity: number;
  admitted: number;
  status: string;
  token: string;
  code: string;
  issued_by: string | null;
  email_sent_at: string | null;
  email_count: number;
  last_entry_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
}

const VIP_COLUMNS =
  "id, event_id, table_label, host_name, email, phone, admin_note, capacity, admitted, status, token, code, issued_by, email_sent_at, email_count, last_entry_at, revoked_at, revoked_by, created_at";

function vipRowOut(row: VipRow) {
  return {
    code: row.code,
    table: row.table_label,
    host: row.host_name,
    email: row.email,
    capacity: row.capacity,
    admitted: row.admitted,
    remaining: vipRemaining(row.capacity, row.admitted),
    status: row.status,
    statusLabel: vipStatusLabel(row.status),
    issuedAt: row.created_at,
    lastEntryAt: row.last_entry_at,
    emailStatus: emailLabel(row.email_sent_at),
    emailCount: row.email_count,
  };
}

async function loadVip(eventId: string, code: string): Promise<VipRow | null> {
  const { data, error } = await admin.from("vip_invitations").select(VIP_COLUMNS).eq("event_id", eventId).eq("code", code).maybeSingle();
  if (error) throw error;
  return (data as VipRow | null) ?? null;
}

interface VipInput {
  eventId: string;
  capacity: number;
  host: string;
  email: string;
  table: string;
  phone: string;
  note: string;
}

function vipInput(body: Record<string, unknown>): VipInput | { error: string } {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const capacity = parseVipCapacity(body.capacity);
  if (capacity == null) return { error: "Access must be between 1 and 6 guests." };
  const host = parseVipHostName(body.name);
  if (!host) return { error: "Enter the primary guest's name." };
  const email = parseStaffEmail(body.email);
  if (!email) return { error: "Enter a valid email address." };
  const table = parseVipTableLabel(body.table);
  if (!table) return { error: "Enter a VIP table or group label (up to 40 characters)." };
  const phone = parseVipPhone(body.phone);
  if (phone == null) return { error: "Enter a valid phone number or leave it empty." };
  const note = parseVipNote(body.note);
  if (note == null) return { error: "Admin notes are limited to 200 characters." };
  return { eventId, capacity, host, email, table, phone, note };
}

async function vipList(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const { data, error } = await admin
    .from("vip_invitations")
    .select(VIP_COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as VipRow[];
  return { summary: vipSummary(rows), invitations: rows.map(vipRowOut) };
}

async function vipView(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  const code = parseVipCode(body.code);
  if (!eventId || !code) return { error: "VIP invitation not found." };
  const row = await loadVip(eventId, code);
  if (!row) return { error: "VIP invitation not found." };
  const [{ data: admissions, error }, staff] = await Promise.all([
    admin
      .from("vip_admissions")
      .select("guests, admitted_after, scanned_by, device, created_at")
      .eq("invitation_id", row.id)
      .order("created_at"),
    admin.from("staff_roles").select("user_id, email"),
  ]);
  if (error) throw error;
  if (staff.error) throw staff.error;
  const people = new Map((staff.data ?? []).map((person) => [person.user_id as string, person.email as string]));
  return {
    invitation: {
      ...vipRowOut(row),
      phone: row.phone,
      note: row.admin_note,
      issuedBy: row.issued_by ? people.get(row.issued_by) ?? "Super admin" : null,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by ? people.get(row.revoked_by) ?? "Super admin" : null,
      passUrl: vipPassUrl(row.token),
    },
    admissions: (admissions ?? []).map((entry) => ({
      guests: entry.guests,
      admittedAfter: entry.admitted_after,
      operator: entry.scanned_by,
      device: entry.device,
      at: entry.created_at,
    })),
  };
}

type ActionResult = { error?: string } & Record<string, unknown>;

async function vipPreview(body: Record<string, unknown>): Promise<ActionResult> {
  const input = vipInput(body);
  if ("error" in input) return input;
  const preview = await renderVipPreview({ hostName: input.host, table: input.table, capacity: input.capacity }, input.eventId);
  if (!preview) return { error: "Event not found" };
  return {
    subject: preview.email.subject,
    html: preview.email.html,
    pass: {
      status: "issued",
      table: input.table,
      host: input.host,
      capacity: input.capacity,
      admitted: 0,
      remaining: input.capacity,
      code: preview.code,
      event: preview.event,
      partners: preview.partners,
    },
  };
}

async function deliverVip(row: VipRow, actor: Actor, ip: string, ua: string, action: "VIP_INVITATION_SENT" | "VIP_INVITATION_RESENT") {
  try {
    await sendVipInvitationEmail(
      { to: row.email, hostName: row.host_name, table: row.table_label, capacity: row.capacity, code: row.code, token: row.token },
      row.event_id,
    );
  } catch (err) {
    console.error(JSON.stringify({ msg: "vip_email_failed", code: row.code, error: (err as Error).message?.slice(0, 200) }));
    await audit(actor, "VIP_EMAIL_FAILED", "vip", row.id, { code: row.code, email: row.email }, ip, ua);
    return false;
  }
  const marked = await admin
    .from("vip_invitations")
    .update({ email_sent_at: new Date().toISOString(), email_count: row.email_count + 1 })
    .eq("id", row.id);
  if (marked.error) console.error(JSON.stringify({ msg: "vip_email_mark_failed", code: row.code }));
  await audit(actor, action, "vip", row.id, {
    code: row.code,
    email: row.email,
    table: row.table_label,
    capacity: row.capacity,
  }, ip, ua);
  return true;
}

async function vipIssue(actor: Actor, body: Record<string, unknown>, ip: string, ua: string): Promise<ActionResult> {
  const input = vipInput(body);
  if ("error" in input) return input;
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) return { error: "Refresh the page and try again." };
  const tiers = (await loadTiers()).filter((tier) => tier.event_id === input.eventId);
  if (!tiers.length) return { error: "Event not found" };

  const { data, error } = await admin.rpc("issue_vip_invitation", {
    p_event_id: input.eventId,
    p_table_label: input.table,
    p_host_name: input.host,
    p_email: input.email,
    p_phone: input.phone || null,
    p_admin_note: input.note || null,
    p_capacity: input.capacity,
    p_idempotency_key: idempotencyKey,
    p_issued_by: actor.id,
  });
  if (error) throw error;
  const result = (Array.isArray(data) ? data[0] : data) as { invitation_id: string | null; outcome: string } | null;
  if (result?.outcome === "table_taken") return { error: `${input.table} already has an active VIP invitation.` };
  if (result?.outcome === "idempotency_mismatch") return { error: "This send request was already used with different details." };
  if (!result?.invitation_id || result.outcome === "rejected") return { error: "The VIP invitation could not be created." };

  const { data: rowData, error: rowError } = await admin.from("vip_invitations").select(VIP_COLUMNS).eq("id", result.invitation_id).single();
  if (rowError) throw rowError;
  const row = rowData as VipRow;
  if (result.outcome === "created") {
    await audit(actor, "VIP_INVITATION_ISSUED", "vip", row.id, {
      code: row.code,
      email: row.email,
      table: row.table_label,
      capacity: row.capacity,
    }, ip, ua);
  }
  if (result.outcome === "exists" && row.email_sent_at) {
    return { ok: true, created: false, invitation: vipRowOut(row), message: `The invitation for ${row.table_label} was already sent.` };
  }
  const sent = await deliverVip(row, actor, ip, ua, "VIP_INVITATION_SENT");
  return {
    ok: sent,
    created: result.outcome === "created",
    invitation: { ...vipRowOut(row), emailStatus: sent ? "Sent" : "Not sent" },
    message: sent
      ? `The VIP invitation for ${row.table_label} was sent to ${row.email}.`
      : `The VIP invitation for ${row.table_label} was created, but the email was not sent. Use Resend from the list below.`,
  };
}

async function vipResend(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const code = parseVipCode(body.code);
  if (!eventId || !code) return { error: "VIP invitation not found." };
  const row = await loadVip(eventId, code);
  if (!row) return { error: "VIP invitation not found." };
  if (row.status === "revoked" || row.status === "cancelled") return { error: "A revoked or cancelled invitation cannot be resent." };
  const sent = await deliverVip(row, actor, ip, ua, "VIP_INVITATION_RESENT");
  return sent
    ? { ok: true, code: row.code, message: `The same VIP invitation was sent again to ${row.email}.` }
    : { ok: false, code: row.code, message: "The email could not be sent. Try again." };
}

async function vipRevoke(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const code = parseVipCode(body.code);
  if (!eventId || !code) return { error: "VIP invitation not found." };
  if (!revokePhraseOk(body.confirm)) return { error: "Type REVOKE to confirm." };
  const { data, error } = await admin
    .from("vip_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: actor.id })
    .eq("event_id", eventId)
    .eq("code", code)
    .in("status", ["issued", "partially_admitted"])
    .select(VIP_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const current = await loadVip(eventId, code);
    if (!current) return { error: "VIP invitation not found." };
    if (current.status === "fully_admitted") return { error: "Every admission on this invitation has already been used." };
    return { error: "This invitation is already revoked or cancelled." };
  }
  const row = data as VipRow;
  await audit(actor, "VIP_INVITATION_REVOKED", "vip", row.id, {
    code: row.code,
    table: row.table_label,
    capacity: row.capacity,
    admitted: row.admitted,
  }, ip, ua);
  return { ok: true, invitation: vipRowOut(row), message: `${row.table_label} was revoked. The pass will no longer admit anyone.` };
}

// Cancellation stays off. The name check stays in source so a later release
// still has to match a server-side event name, not a name the browser sends.
async function cancelConfirm(body: Record<string, unknown>) {
  throw new Error("mutations_disabled");
  const eventId = String(body.eventId ?? "");
  const typed = String(body.confirmName ?? "").trim();
  const expected = EVENT_NAMES[eventId];
  if (!expected || typed !== expected) return { error: "Type the event name and a reason to cancel." };
  return { error: "This action is not available." };
}

void cancelConfirm;

async function complimentaryView(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  if (!eventId || !prefix) return { error: "Complimentary order not found." };
  const order = await loadComplimentaryOrder(eventId, prefix);
  if (!order) return { error: "Complimentary order not found." };
  const { data, error } = await admin
    .from("tickets")
    .select("guest_number, status, checked_in_at, revoked_at")
    .eq("order_id", order.id)
    .eq("event_id", eventId)
    .order("guest_number");
  if (error) throw error;
  const passes = data ?? [];
  const counts = complimentaryPassCounts(passes);
  return {
    ref: orderRefFromId(order.id),
    name: order.purchaser_name,
    email: order.purchaser_email,
    ...counts,
    status: complimentaryIssuanceStatus(passes),
    passes: passes.map((pass) => ({
      guestNumber: pass.guest_number,
      status: pass.status === "checked-in" ? "USED" : pass.status === "revoked" ? "REVOKED" : pass.status === "valid" ? "VALID" : pass.status.toUpperCase(),
      checkedInAt: pass.checked_in_at,
      revokedAt: pass.revoked_at,
    })),
  };
}

async function revokeComplimentaryPass(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  const guestNumber = parseGuestNumber(body.guestNumber);
  if (body.confirm !== "REVOKE PASS") return { error: "Confirm the pass revocation." };
  if (!eventId || !prefix || !guestNumber) return { error: "Complimentary pass not found." };
  const order = await loadComplimentaryOrder(eventId, prefix);
  if (!order) return { error: "Complimentary order not found." };
  const { data, error } = await admin.rpc("revoke_complimentary_pass", {
    p_event_id: eventId,
    p_order_id: order.id,
    p_guest_number: guestNumber,
    p_actor: actor.id,
  });
  if (error) throw error;
  const outcome = (Array.isArray(data) ? data[0] : data) as { outcome: string } | null;
  if (!outcome || outcome.outcome === "not_found") return { error: "Complimentary pass not found." };
  if (outcome.outcome === "used") return { error: "This pass was already used. Its admission stays on record." };
  if (outcome.outcome === "rejected") return { error: "This pass cannot be revoked." };
  if (outcome.outcome === "revoked") {
    await audit(actor, "COMPLIMENTARY_PASS_REVOKED", "order", order.id, {
      ref: orderRefFromId(order.id),
      guest_number: guestNumber,
    }, ip, ua);
  }
  return { ok: true, ref: orderRefFromId(order.id), guestNumber, outcome: outcome.outcome };
}

async function revokeComplimentaryIssuance(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  if (body.confirm !== "REVOKE REMAINING") return { error: "Confirm the revocation." };
  if (!eventId || !prefix) return { error: "Complimentary order not found." };
  const order = await loadComplimentaryOrder(eventId, prefix);
  if (!order) return { error: "Complimentary order not found." };
  const { data, error } = await admin.rpc("revoke_complimentary_remaining", {
    p_event_id: eventId,
    p_order_id: order.id,
    p_actor: actor.id,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { outcome: string; revoked_count: number } | null;
  if (!row || row.outcome === "not_found") return { error: "Complimentary order not found." };
  if (row.outcome === "rejected") return { error: "This invitation cannot be revoked." };
  if (row.outcome === "revoked") {
    await audit(actor, "COMPLIMENTARY_ISSUANCE_REVOKED", "order", order.id, {
      ref: orderRefFromId(order.id),
      revoked_count: row.revoked_count,
    }, ip, ua);
  }
  return {
    ok: true,
    ref: orderRefFromId(order.id),
    revoked: row.revoked_count,
    message: row.revoked_count > 0
      ? `${row.revoked_count} remaining ${row.revoked_count === 1 ? "pass was" : "passes were"} revoked. Used passes stay used.`
      : "No valid passes remained.",
  };
}

interface CashTier {
  tier_id: string;
  name: string;
  price_cents: number;
  currency: string;
  admits: number;
  capacity: number | null;
  max_per_order: number;
  active: boolean;
  opens_after: string | null;
  metadata: Record<string, unknown> | null;
}

async function priceCashSale(eventId: string, rawItems: unknown, promoRaw: unknown) {
  const parsed = parseCartItems(rawItems);
  if ("error" in parsed) return { error: "Choose the tickets for this sale." as const };
  const items = parsed.items as { tierId: string; quantity: number }[];
  const { data, error } = await admin
    .from("tiers")
    .select("tier_id, name, price_cents, currency, admits, capacity, max_per_order, active, opens_after, metadata")
    .eq("event_id", eventId)
    .in("tier_id", items.map((item) => item.tierId));
  if (error) throw error;
  const tiers = new Map((data ?? []).map((row) => [row.tier_id, row as CashTier]));
  let admissions = 0;
  const lines = [];
  for (const item of items) {
    const tier = tiers.get(item.tierId);
    if (!tier || !tier.active) return { error: "This pass isn't available." as const };
    if (item.quantity > Math.min(tier.max_per_order, 10)) return { error: `Up to ${Math.min(tier.max_per_order, 10)} ${tier.name} per sale.` as const };
    if (tier.opens_after) {
      const { data: gate } = await admin.from("tiers").select("active, capacity").eq("event_id", eventId).eq("tier_id", tier.opens_after).maybeSingle();
      const gateSold = gate?.capacity != null ? await countSold(eventId, tier.opens_after) : 0;
      const open = !gate || !gate.active || (gate.capacity !== null && gateSold >= gate.capacity);
      if (!open) return { error: `${tier.name} isn't on sale.` as const };
    }
    if (tier.capacity != null) {
      const sold = await countSold(eventId, tier.tier_id);
      const held = await countHeld(eventId, tier.tier_id);
      if (sold + held + item.quantity > tier.capacity) return { error: `${tier.name} does not have enough left.` as const, code: "oversold" as const };
    }
    admissions += item.quantity * Math.max(tier.admits, 1);
    lines.push({ tierId: tier.tier_id, name: tier.name, unitCents: tier.price_cents, quantity: item.quantity, admits: tier.admits });
  }
  if (admissions > 20) return { error: "Up to 20 admissions per sale." as const };
  if (lines.some((line) => line.unitCents == null) || new Set(lines.map(() => tiers.get(lines[0].tierId)?.currency)).size > 1) {
    return { error: "This pass isn't available." as const };
  }
  const currency = tiers.get(lines[0].tierId)?.currency ?? "usd";
  if ([...tiers.values()].some((tier) => tier.currency !== currency)) return { error: "This pass isn't available." as const };

  const promoCode = normalizePromoCode(promoRaw);
  if (promoCode === null) return { error: "That promo code is not valid." as const, code: "promo_invalid" as const };
  let promo: { id: string; code: string; percent: number; eligibleTierIds: string[]; eligibleNames: string[] } | null = null;
  if (promoCode) {
    const { data: row, error: promoError } = await admin
      .from("promotions")
      .select("id, code, event_id, discount_type, discount_value, active, starts_at, expires_at, eligible_tier_ids")
      .eq("event_id", eventId)
      .eq("code", promoCode)
      .maybeSingle();
    if (promoError) throw promoError;
    if (!row || !promotionIsLive(row, eventId)) return { error: "PROMO CODE NOT VALID" as const, code: "promo_invalid" as const };
    const eligible = eligibleTierIds(row);
    if (promoHasNoEligibleLine(lines, eligible)) {
      const { data: named } = await admin.from("tiers").select("tier_id, name").eq("event_id", eventId).in("tier_id", eligible);
      const names = eligible.map((id) => (named ?? []).find((tier: { tier_id: string; name: string }) => tier.tier_id === id)?.name).filter((name): name is string => Boolean(name));
      return { error: promoEligibilityMessage(row.code, names) as string, code: "PROMO_NOT_ELIGIBLE" as const };
    }
    const { data: named, error: nameError } = await admin.from("tiers").select("tier_id, name").eq("event_id", eventId).in("tier_id", eligible);
    if (nameError) throw nameError;
    const namesById = new Map((named ?? []).map((tier: { tier_id: string; name: string }) => [tier.tier_id, tier.name]));
    promo = {
      id: row.id,
      code: row.code,
      percent: row.discount_value,
      eligibleTierIds: eligible,
      eligibleNames: eligible.map((id) => namesById.get(id)).filter((name): name is string => Boolean(name)),
    };
  }

  const priced = priceCart(lines, promo ? { percent: promo.percent, eligibleTierIds: promo.eligibleTierIds } : null);
  let quoted: { tax: number; total: number; calculationId: string };
  try {
    quoted = await quoteCartTotal(
      taxClient(),
      currency,
      priced.lines.map((line: { discountedLineCents: number; tierId: string }) => ({ amount: line.discountedLineCents, reference: line.tierId })),
    );
  } catch (err) {
    console.error(JSON.stringify({ msg: "cash_tax_quote_failed", eventId, error: (err as Error).message?.slice(0, 200) }));
    return { error: "Tax could not be calculated. Nothing was issued." as const };
  }
  const snapshot = buildCartSnapshot({
    priced,
    tax: quoted.tax,
    currency,
    promo: promo ? { id: promo.id, code: promo.code, percent: promo.percent, eligibleTierIds: promo.eligibleTierIds } : null,
  });
  return { items, priced, quoted, snapshot, promo, currency, admissions };
}

function taxClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("tax_unavailable");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

async function countSold(eventId: string, tierId: string) {
  const { data, error } = await admin.rpc("tier_sold", { p_event_id: eventId, p_tier_id: tierId });
  if (error) throw error;
  return Number(data ?? 0);
}

async function countHeld(eventId: string, tierId: string) {
  const { data, error } = await admin.rpc("tier_held", { p_event_id: eventId, p_tier_id: tierId });
  if (error) throw error;
  return Number(data ?? 0);
}

function cashPreview(priced: ReturnType<typeof priceCashSale> extends Promise<infer R> ? R : never) {
  if (!priced || "error" in priced) return priced;
  return {
    lines: priced.priced.lines.map((line: { tierId: string; name: string; quantity: number; totalAdmissions: number; originalLineCents: number; discountCents: number; discountedLineCents: number; promoEligible: boolean }) => ({
      ticketType: line.tierId,
      name: line.name,
      quantity: line.quantity,
      admissions: line.totalAdmissions,
      lineSubtotal: line.originalLineCents,
      discount: line.discountCents,
      discountedSubtotal: line.discountedLineCents,
      promoEligible: line.promoEligible,
    })),
    totalAdmissions: priced.admissions,
    originalSubtotal: priced.priced.originalSubtotal,
    discount: priced.priced.discount,
    discountedSubtotal: priced.priced.discountedSubtotal,
    tax: priced.quoted.tax,
    total: priced.quoted.total,
    currency: priced.currency,
    promo: priced.promo ? { code: priced.promo.code, percent: priced.promo.percent, eligibleNames: priced.promo.eligibleNames } : null,
  };
}

async function cashQuote(body: Record<string, unknown>) {
  const eventId = textEvent(body);
  if (!eventId) return { error: "eventId required" };
  const priced = await priceCashSale(eventId, body.items, body.promoCode);
  if ("error" in priced) return priced;
  return cashPreview(priced);
}

async function eventMetadata(eventId: string): Promise<Record<string, string>> {
  const { data, error } = await admin.from("tiers").select("metadata").eq("event_id", eventId);
  if (error) throw error;
  const meta = (data ?? []).map((row) => row.metadata).find((value) => value && typeof value === "object" && (value as Record<string, unknown>).omc_event_name);
  const out: Record<string, string> = {};
  if (meta && typeof meta === "object") {
    for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

async function cashIssue(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const name = parseComplimentaryName(body.name);
  const email = parseStaffEmail(body.email);
  const phone = parseVipPhone(body.phone);
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  const expected = typeof body.expectedTotal === "number" ? body.expectedTotal : Number(body.expectedTotal);
  if (!cashReceivedPhraseOk(body.confirm)) return { error: "Confirm that the cash was received." };
  if (!eventId || !name || !email || phone == null || !idempotencyKey || !Number.isInteger(expected)) {
    return { error: "A name, email, and the quoted total are required." };
  }
  const priced = await priceCashSale(eventId, body.items, body.promoCode);
  if ("error" in priced) return priced;
  if (priced.quoted.total !== expected) return { error: "The amount changed. Review the sale again.", code: "amount_changed" };
  const { data, error } = await admin.rpc("create_cash_order", {
    p_event_id: eventId,
    p_items: priced.items.map((item) => ({ tier_id: item.tierId, quantity: item.quantity })),
    p_snapshot: priced.snapshot,
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_idempotency_key: idempotencyKey,
    p_issued_by: actor.id,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string | null; outcome: string } | null;
  if (row?.outcome === "oversold") return { error: "One of these tickets sold out. Nothing was issued.", code: "oversold" };
  if (row?.outcome === "unavailable") return { error: "This pass isn't available. Nothing was issued." };
  if (row?.outcome === "idempotency_mismatch") return { error: "This confirmation was already used with different details." };
  if (!row?.order_id || row.outcome === "rejected") return { error: "The cash sale could not be issued. Nothing was left half-created." };
  if (row.outcome === "created") {
    await audit(actor, "CASH_SALE_ISSUED", "order", row.order_id, {
      ref: orderRefFromId(row.order_id),
      total: priced.quoted.total,
      admissions: priced.admissions,
      promo: priced.promo?.code ?? "",
    }, ip, ua);
  }
  let emailStatus = "Not sent";
  try {
    const delivery = await sendOrderTicketEmail(row.order_id, await eventMetadata(eventId));
    emailStatus = delivery.status === "not_sendable" ? "Not sent" : "Sent";
  } catch (err) {
    console.error(JSON.stringify({ msg: "cash_email_failed", orderId: row.order_id, error: (err as Error).message?.slice(0, 200) }));
  }
  return {
    ok: true,
    created: row.outcome === "created",
    ref: orderRefFromId(row.order_id),
    total: priced.quoted.total,
    currency: priced.currency,
    emailStatus,
    message: row.outcome === "created"
      ? `Cash sale recorded. ${emailStatus === "Sent" ? `Passes were sent to ${email}.` : "The passes exist, but the email was not sent."}`
      : `This confirmation was already recorded as ${orderRefFromId(row.order_id)}.`,
  };
}

async function cashRefund(actor: Actor, body: Record<string, unknown>, ip: string, ua: string) {
  const eventId = textEvent(body);
  const prefix = parseOrderRef(body.ref);
  if (!cashReturnedPhraseOk(body.confirm)) return { error: "Confirm that the cash was returned to the customer." };
  if (!eventId || !prefix) return { error: "Order not found" };
  const ids = await idsWithPrefix("orders", eventId, prefix);
  if (ids.length !== 1) return { error: "Order not found" };
  const { data: existing, error: readError } = await admin
    .from("orders")
    .select("id, payment_method, status, stripe_payment_intent, is_test")
    .eq("id", ids[0])
    .eq("event_id", eventId)
    .eq("is_test", false)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing || existing.payment_method !== "cash") return { error: "This is not a cash sale." };
  if (existing.stripe_payment_intent) return { error: "This order has a card charge. Use the card refund." };
  const { data, error } = await admin.rpc("refund_cash_order", {
    p_event_id: eventId,
    p_order_id: existing.id,
    p_actor: actor.id,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { outcome: string; cancelled_count: number } | null;
  if (!row || row.outcome === "not_found") return { error: "Order not found" };
  if (row.outcome === "admitted") {
    return { error: "CASH REFUND NOT AVAILABLE. One or more tickets from this order have already been admitted." };
  }
  if (row.outcome === "rejected") return { error: "This cash sale cannot be refunded." };
  if (row.outcome === "refunded") {
    await audit(actor, "CASH_SALE_REFUNDED", "order", existing.id, {
      ref: orderRefFromId(existing.id),
      cancelled_passes: row.cancelled_count,
    }, ip, ua);
  }
  return {
    ok: true,
    ref: orderRefFromId(existing.id),
    outcome: row.outcome,
    cancelled: row.cancelled_count,
    message: row.outcome === "exists"
      ? "This cash sale was already refunded."
      : "The cash sale was refunded. Every pass was cancelled and the inventory was restored.",
  };
}


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
