// Public: tickets sold per tier, so the site can mark capped tiers (Early Bird)
// sold out and reveal the tiers that open after them — no manual edit needed.
//   GET ?event=<event id>  →  { sold: { "early-bird": 50, ... } }

import { admin, corsHeaders, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const eventId = new URL(req.url).searchParams.get("event") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/i.test(eventId)) return json(req, { error: "Bad event" }, 400);

  const { data, error } = await admin
    .from("orders")
    .select("tier_id, quantity")
    .eq("event_id", eventId)
    .neq("status", "refunded");
  if (error) {
    console.error(error);
    return json(req, { error: "Server error" }, 500);
  }

  const sold: Record<string, number> = {};
  for (const o of data) sold[o.tier_id] = (sold[o.tier_id] ?? 0) + o.quantity;
  return json(req, { sold });
});
