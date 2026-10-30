// Temporary public RSVP endpoint for the Oct 30 House Party.
// Capacity, expiry, duplicates, and confirmation all remain in Postgres RPCs.

import { admin, corsHeaders, json } from "../_shared/http.ts";
import { sendHousePartyCancellationEmail, sendHousePartyEmail, sendHousePartyOrganizerEmail } from "../_shared/house-party-email.ts";

const EVENT_SLUG = "diwali-halloween-house-party-2026";

type StatusRow = {
  state: "active" | "full" | "ended";
  capacity: number;
  confirmed_people: number;
  rsvp_groups: number;
  spots_remaining: number;
};

type ReservationRow = {
  outcome: "confirmed" | "duplicate" | "full" | "insufficient_capacity" | "ended" | "invalid";
  rsvp_id: string | null;
  confirmed_party_size: number | null;
  remaining_capacity: number | null;
  existing_party_size: number | null;
};

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error(JSON.stringify({ msg: "house_party_error", error: (error as Error).message?.slice(0, 300) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method === "GET") {
    const pass = new URL(req.url).searchParams.get("pass");
    return pass ? passView(req, pass) : publicStatus(req);
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ip = clientIp(req);
  const { data: allowed, error: limitError } = await admin.rpc("allow_request", {
    p_bucket: `house-party:${ip}`,
    p_limit: 8,
    p_window_seconds: 600,
  });
  if (limitError) console.error(JSON.stringify({ msg: "house_party_rate_limit_failed" }));
  if (!limitError && allowed === false) return json(req, { error: "Please wait a moment and try again." }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Bad request." }, 400);
  }

  if (body.action === "resend") return resendPass(req, body);
  if (body.action === "cancel") return cancelRsvp(req, body);
  if (body.ageConfirmed !== true) return json(req, { error: "Please confirm that everyone in your RSVP is 21+.", code: "age_required" }, 400);

  const partySize = Number(body.partySize);
  const guestNames = Array.isArray(body.guestNames) ? body.guestNames.filter((name): name is string => typeof name === "string") : [];
  const reserved = await admin.rpc("create_house_party_rsvp", {
    p_slug: EVENT_SLUG,
    p_full_name: stringValue(body.fullName, 120),
    p_email: stringValue(body.email, 200),
    p_phone: stringValue(body.phone, 40),
    p_instagram: stringValue(body.instagram, 100),
    p_party_size: partySize,
    p_guest_names: guestNames,
  });
  if (reserved.error) {
    console.error(JSON.stringify({ msg: "house_party_reservation_failed", error: reserved.error.message.slice(0, 160) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }

  const result = first<ReservationRow>(reserved.data);
  if (!result) return json(req, { error: "Something went wrong. Please try again." }, 500);

  switch (result.outcome) {
    case "confirmed": {
      const issued = await issuePass(result.rsvp_id);
      await notifyOrganizer(result.rsvp_id);
      return json(req, {
        status: "confirmed",
        partySize: result.confirmed_party_size,
        spotsRemaining: result.remaining_capacity,
        fullName: issued.fullName,
        passToken: issued.token,
        emailSent: issued.emailSent,
      });
    }
    case "duplicate":
      return json(req, {
        status: "duplicate",
        existingPartySize: result.existing_party_size,
        spotsRemaining: result.remaining_capacity,
        error: "YOU ALREADY HAVE AN RSVP",
      }, 409);
    case "insufficient_capacity":
      return json(req, {
        status: "insufficient_capacity",
        spotsRemaining: result.remaining_capacity,
        error: capacityMessage(result.remaining_capacity),
      }, 409);
    case "full":
      return json(req, { status: "full", spotsRemaining: 0, error: "HOUSE FULL" }, 409);
    case "ended":
      return json(req, { status: "ended", spotsRemaining: 0, error: "THIS EVENT HAS ENDED." }, 410);
    default:
      return json(req, { status: "invalid", error: "Please check your RSVP details." }, 400);
  }
}

async function publicStatus(req: Request): Promise<Response> {
  const { data, error } = await admin.rpc("house_party_status", { p_slug: EVENT_SLUG });
  if (error) {
    console.error(JSON.stringify({ msg: "house_party_status_failed", error: error.message.slice(0, 160) }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  const status = first<StatusRow>(data) ?? {
    state: "ended",
    capacity: 0,
    confirmed_people: 0,
    rsvp_groups: 0,
    spots_remaining: 0,
  };
  return json(req, {
    state: status.state,
    capacity: status.capacity,
    confirmedPeople: status.confirmed_people,
    rsvpGroups: status.rsvp_groups,
    spotsRemaining: status.spots_remaining,
  });
}

async function issuePass(rsvpId: string | null): Promise<{ token: string | null; emailSent: boolean; fullName: string | null }> {
  if (!rsvpId) return { token: null, emailSent: false, fullName: null };
  const token = randomToken();
  const saved = await admin.from("house_party_rsvps").update({ confirmation_token: token }).eq("id", rsvpId).is("confirmation_token", null).select("full_name, email, party_size, guest_names, status").maybeSingle();
  if (saved.error || !saved.data || saved.data.status !== "confirmed") {
    console.error(JSON.stringify({ msg: "house_party_pass_failed" }));
    return { token: null, emailSent: false, fullName: null };
  }
  const emailSent = await deliverPass({
    id: rsvpId,
    token,
    fullName: saved.data.full_name,
    email: saved.data.email,
    partySize: saved.data.party_size,
    guestNames: saved.data.guest_names ?? [],
  });
  return { token, emailSent, fullName: saved.data.full_name };
}

async function deliverPass(pass: { id: string; token: string; fullName: string; email: string; partySize: number; guestNames: string[] }): Promise<boolean> {
  try {
    await sendHousePartyEmail({
      to: pass.email,
      fullName: pass.fullName,
      partySize: pass.partySize,
      guestNames: pass.guestNames,
      code: passCode(pass.token),
      token: pass.token,
    });
    const marked = await admin.from("house_party_rsvps").update({ email_sent_at: new Date().toISOString() }).eq("id", pass.id);
    if (marked.error) console.error(JSON.stringify({ msg: "house_party_email_mark_failed" }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({ msg: "house_party_email_failed", error: (error as Error).message?.slice(0, 120) }));
    return false;
  }
}

async function passView(req: Request, token: string): Promise<Response> {
  if (!/^[0-9a-f]{48}$/.test(token)) return json(req, { error: "Not found" }, 404);
  const { data, error } = await admin
    .from("house_party_rsvps")
    .select("full_name, party_size, guest_names, status")
    .eq("confirmation_token", token)
    .maybeSingle();
  if (error) return json(req, { error: "Something went wrong. Please try again." }, 500);
  if (!data || data.status !== "confirmed") return json(req, { error: "Not found" }, 404);
  return json(req, {
    fullName: data.full_name,
    partySize: data.party_size,
    guestNames: data.guest_names ?? [],
    code: passCode(token),
  });
}

async function notifyOrganizer(rsvpId: string | null): Promise<void> {
  if (!rsvpId) return;
  try {
    const { data, error } = await admin
      .from("house_party_rsvps")
      .select("full_name, email, phone, instagram, party_size, guest_names, created_at, confirmation_token, status")
      .eq("id", rsvpId)
      .maybeSingle();
    if (error || !data || data.status !== "confirmed") {
      console.error(JSON.stringify({ msg: "house_party_organizer_email_skipped" }));
      return;
    }
    const capacity = await capacitySnapshot();
    if (!capacity) {
      console.error(JSON.stringify({ msg: "house_party_organizer_email_skipped" }));
      return;
    }
    await sendHousePartyOrganizerEmail({
      fullName: data.full_name,
      partySize: data.party_size,
      guestNames: data.guest_names ?? [],
      email: data.email,
      phone: data.phone,
      instagram: data.instagram,
      rsvpTime: chicagoTime(data.created_at),
      code: data.confirmation_token ? passCode(data.confirmation_token) : null,
      confirmedPeople: capacity.confirmed_people,
      capacity: capacity.capacity,
      spotsRemaining: capacity.spots_remaining,
    });
    console.log(JSON.stringify({ msg: "house_party_organizer_email_sent", partySize: data.party_size, spotsRemaining: capacity.spots_remaining }));
  } catch (error) {
    console.error(JSON.stringify({ msg: "house_party_organizer_email_failed", error: (error as Error).message?.slice(0, 120) }));
  }
}

async function cancelRsvp(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!serviceAuthorized(req)) return json(req, { error: "Not authorised" }, 401);
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{48}$/.test(token)) return json(req, { error: "Not found" }, 404);
  const cancelled = await admin
    .from("house_party_rsvps")
    .update({ status: "cancelled" })
    .eq("confirmation_token", token)
    .eq("status", "confirmed")
    .select("full_name, party_size")
    .maybeSingle();
  if (cancelled.error) {
    console.error(JSON.stringify({ msg: "house_party_cancel_failed" }));
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  if (!cancelled.data) return json(req, { error: "Not found" }, 404);

  const capacity = await capacitySnapshot();
  let emailSent = false;
  if (capacity) {
    try {
      await sendHousePartyCancellationEmail({
        fullName: cancelled.data.full_name,
        partySize: cancelled.data.party_size,
        cancelledAt: chicagoTime(new Date().toISOString()),
        confirmedPeople: capacity.confirmed_people,
        capacity: capacity.capacity,
        spotsRemaining: capacity.spots_remaining,
      });
      emailSent = true;
    } catch (error) {
      console.error(JSON.stringify({ msg: "house_party_cancel_email_failed", error: (error as Error).message?.slice(0, 120) }));
    }
  }
  return json(req, {
    status: "cancelled",
    emailSent,
    spotsRemaining: capacity?.spots_remaining ?? null,
  });
}

async function capacitySnapshot(): Promise<StatusRow | null> {
  const event = await admin.from("house_party_events").select("id, capacity").eq("slug", EVENT_SLUG).maybeSingle();
  if (event.error || !event.data) return null;
  const confirmed = await admin.from("house_party_rsvps").select("party_size").eq("event_id", event.data.id).eq("status", "confirmed");
  if (confirmed.error) return null;
  const confirmedPeople = (confirmed.data ?? []).reduce((sum, row) => sum + row.party_size, 0);
  return {
    state: confirmedPeople >= event.data.capacity ? "full" : "active",
    capacity: event.data.capacity,
    confirmed_people: confirmedPeople,
    rsvp_groups: confirmed.data?.length ?? 0,
    spots_remaining: Math.max(event.data.capacity - confirmedPeople, 0),
  };
}

function serviceAuthorized(req: Request): boolean {
  const key = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = req.headers.get("authorization") ?? "";
  if (key.length > 0 && bearer === `Bearer ${key}`) return true;
  const presented = req.headers.get("apikey") ?? "";
  const secrets = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  return presented.startsWith("sb_secret_") && secrets.includes(presented);
}

function chicagoTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

async function resendPass(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!serviceAuthorized(req)) return json(req, { error: "Not authorised" }, 401);
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{48}$/.test(token)) return json(req, { error: "Not found" }, 404);
  const { data, error } = await admin
    .from("house_party_rsvps")
    .select("id, full_name, email, party_size, guest_names, status, confirmation_token")
    .eq("confirmation_token", token)
    .maybeSingle();
  if (error || !data || data.status !== "confirmed" || !data.confirmation_token) return json(req, { error: "Not found" }, 404);
  const emailSent = await deliverPass({
    id: data.id,
    token: data.confirmation_token,
    fullName: data.full_name,
    email: data.email,
    partySize: data.party_size,
    guestNames: data.guest_names ?? [],
  });
  return json(req, { emailSent });
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function passCode(token: string): string {
  return token.slice(0, 8).toUpperCase();
}

function first<T>(value: unknown): T | null {
  return Array.isArray(value) && value[0] ? value[0] as T : null;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function capacityMessage(remaining: number | null): string {
  if (!remaining || remaining < 1) return "HOUSE FULL";
  return `ONLY ${remaining} SPOT${remaining === 1 ? "" : "S"} REMAIN${remaining === 1 ? "S" : ""}`;
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim().slice(0, 64) || "unknown";
}
