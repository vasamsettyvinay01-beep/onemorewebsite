// Public read of one private VIP credential for the /vip page.
//   POST { token }   the token is the fragment of the link in the invitation email
//
// The response carries only the table, host, allocation, display code, event
// facts, and partners. Never email, phone, admin note, issuer, or row ids.
// POST keeps the token out of URLs and request logs.

import { admin, corsHeaders } from "../_shared/http.ts";
import { loadVipEvent } from "../_shared/vip-delivery.ts";
import { isVipToken, publicVipPass } from "../_shared/vip.mjs";

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim().slice(0, 64) || "unknown";
  const { data: allowed, error: limitError } = await admin.rpc("allow_request", {
    p_bucket: `vip-pass:${ip}`,
    p_limit: 60,
    p_window_seconds: 600,
  });
  if (!limitError && allowed === false) return reply(req, { error: "Please wait a moment and try again." }, 429);

  let token = "";
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token.trim().toLowerCase() : "";
  } catch {
    return reply(req, { error: "Not found" }, 404);
  }
  if (!isVipToken(token)) return reply(req, { error: "Not found" }, 404);

  try {
    const { data, error } = await admin
      .from("vip_invitations")
      .select("event_id, table_label, host_name, capacity, admitted, status, code")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return reply(req, { error: "Not found" }, 404);
    const pass = publicVipPass(data, null, []);
    if (pass.status === "inactive") return reply(req, pass);
    const loaded = await loadVipEvent(data.event_id);
    return reply(req, publicVipPass(data, loaded?.event ?? null, loaded?.partners ?? []));
  } catch (err) {
    console.error(JSON.stringify({ msg: "vip_pass_failed", error: (err as Error).message?.slice(0, 160) }));
    return reply(req, { error: "Server error" }, 500);
  }
});
