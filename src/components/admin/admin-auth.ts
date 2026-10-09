import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { backend } from "@/data/backend";

let client: SupabaseClient | null = null;

/** Tab session only. The admin API checks this token; the role is not stored here. */
export function adminAuth(): SupabaseClient {
  client ??= createClient(backend.supabaseUrl, backend.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "omc-admin", storage: window.sessionStorage },
  });
  return client;
}

/** Display hint only. The API rejects anything short of aal2. */
export function sessionAal(token: string | undefined): string {
  if (!token) return "aal1";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.aal === "string" ? payload.aal : "aal1";
  } catch {
    return "aal1";
  }
}
