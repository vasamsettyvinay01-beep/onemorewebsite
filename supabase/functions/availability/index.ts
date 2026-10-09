// Public: tickets sold per tier, so the site can mark capped tiers (Early Bird)
// sold out and reveal the tiers that open after them — no manual edit needed.
//   GET ?event=<event id>  →  { sold: { "early-bird": 50, ... } }

import { admin, corsHeaders, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const eventId = new URL(req.url).searchParams.get("event") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/i.test(eventId)) return json(req, { error: "Bad event" }, 400);

  const [sales, holds] = await Promise.all([
    admin.rpc("event_sales", { p_event_id: eventId }),
    admin.rpc("event_holds", { p_event_id: eventId }),
  ]);
  if (sales.error || holds.error) {
    console.error(JSON.stringify({ msg: "availability_failed", eventId }));
    return json(req, { error: "Server error" }, 500);
  }

  const sold: Record<string, number> = {};
  const held: Record<string, number> = {};
  for (const row of sales.data ?? []) sold[row.tier_id] = row.quantity;
  for (const row of holds.data ?? []) held[row.tier_id] = row.quantity;
  return json(req, { sold, held });
});
