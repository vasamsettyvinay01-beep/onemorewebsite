/**
 * Emails passes for paid orders that were never emailed (e.g. Resend was down or not yet set up).
 *
 *   SUPABASE_URL=https://<ref>.supabase.co npx deno run -A --node-modules-dir=none \
 *     --env-file=supabase/.env.secrets scripts/send-pending-passes.ts [order-id]
 *
 * Event details come from the `tiers` metadata synced by `npm run stripe:setup`.
 */
import { admin } from "../supabase/functions/_shared/http.ts";
import { readPartners, sendTicketEmail } from "../supabase/functions/_shared/email.ts";

const only = Deno.args[0];
let query = admin
  .from("orders")
  .select("id, event_id, tier_id, tier_name, purchaser_name, purchaser_email, access_token, tickets(guest_number, token)")
  .eq("status", "paid")
  .is("emailed_at", null);
if (only) query = query.eq("id", only);

const { data: orders, error } = await query;
if (error) throw error;
if (!orders.length) console.log("Nothing to send.");

for (const order of orders) {
  const { data: tier } = await admin
    .from("tiers")
    .select("metadata")
    .eq("event_id", order.event_id)
    .eq("tier_id", order.tier_id)
    .maybeSingle();
  const meta: Record<string, string> = tier?.metadata ?? {};
  try {
    await sendTicketEmail({
      to: order.purchaser_email,
      name: order.purchaser_name,
      eventName: meta.omc_event_name ?? "One More",
      chapter: meta.omc_chapter || undefined,
      dateLabel: meta.omc_event_date ?? "",
      timeLabel: meta.omc_event_time ?? "",
      venueName: meta.omc_venue_name ?? "",
      venueAddress: meta.omc_venue_address ?? "",
      mapUrl: meta.omc_map_url || undefined,
      heroUrl: meta.omc_hero_url || undefined,
      tierName: order.tier_name,
      invitation: meta.omc_invitation || undefined,
      partner: meta.omc_partner || undefined,
      notice: meta.omc_notice || undefined,
      partners: readPartners(meta.omc_partners),
      minimumAge: meta.omc_min_age ? Number(meta.omc_min_age) : undefined,
      accessToken: order.access_token,
      tickets: [...order.tickets].sort((a, b) => a.guest_number - b.guest_number),
    });
    await admin.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", order.id);
    console.log(`sent  ${order.tier_name} × ${order.tickets.length} → ${order.purchaser_email}`);
  } catch (err) {
    console.error(`failed ${order.id} → ${order.purchaser_email}: ${(err as Error).message}`);
  }
}
