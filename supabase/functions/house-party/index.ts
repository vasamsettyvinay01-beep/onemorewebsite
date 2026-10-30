// Temporary public RSVP endpoint for the Oct 30 House Party.
// Capacity, expiry, duplicates, and confirmation all remain in Postgres RPCs.

import { admin, corsHeaders, json } from "../_shared/http.ts";

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
  if (req.method === "GET") return publicStatus(req);
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
    case "confirmed":
      return json(req, {
        status: "confirmed",
        partySize: result.confirmed_party_size,
        spotsRemaining: result.remaining_capacity,
      });
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
