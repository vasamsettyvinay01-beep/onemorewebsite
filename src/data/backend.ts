/**
 * Ticketing backend (Supabase project dedicated to One More tickets).
 *
 * Both values are public by design — they ship to every browser. All data
 * access is enforced server-side in the Edge Functions under supabase/functions.
 */
export const backend = {
  supabaseUrl: "https://curprrfrkefegefqiign.supabase.co",
  /** Supabase "publishable" (or legacy anon) key. */
  supabaseKey: "sb_publishable_tMWkZJVyHzIMw6ZWkhYAlA_ghyiyqHU",
  /** Stripe publishable key (pk_test_… / pk_live_…). */
  stripeKey:
    "pk_test_51UOA7cFq1NbISn8sc6ttFjdruxFKlW2l7N81DJojeRXxuHriQL6zEFpX3qj5B5GVSjdwelaRKzsvABfa4fV4TMEX00PRHlMoQm",
  /** The shared door login, created in Supabase → Authentication → Users. */
  doorEmail: "door@theonemorecompany.com",
};

export const backendConfigured = Boolean(backend.supabaseUrl && backend.supabaseKey);

export function functionUrl(name: string): string {
  return `${backend.supabaseUrl}/functions/v1/${name}`;
}
