import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { backend, functionUrl } from "@/data/backend";
import { adminAuth, sessionAal } from "@/components/admin/admin-auth";

let client: SupabaseClient | null = null;
let activeSource: DoorSessionSource | null = null;

export type DoorSessionSource = "staff" | "door";

/** Legacy scanner session. Privileged staff sessions stay in the operations client. */
export function doorAuth(): SupabaseClient {
  client ??= createClient(backend.supabaseUrl, backend.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "omc-door" },
  });
  return client;
}

export function setDoorSessionSource(source: DoorSessionSource | null) {
  activeSource = source;
}

function activeClient(): SupabaseClient {
  return activeSource === "staff" ? adminAuth() : doorAuth();
}

export type ScanOutcome = "admitted" | "already-used" | "cancelled" | "wrong-event" | "not-found";

export interface ScanResult {
  outcome: ScanOutcome;
  ticket_id: string | null;
  guest_number: number | null;
  guest_count: number | null;
  tier_name: string | null;
  purchaser_name: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
}

export interface DoorStats {
  guests: number;
  inside: number;
  byTier: Record<string, { sold: number; in: number }>;
}

export interface GuestOrder {
  id: string;
  purchaser_name: string | null;
  purchaser_email: string;
  tier_name: string;
  status: string;
  tickets: { id: string; guest_number: number; status: string; checked_in_at: string | null }[];
}

export class DoorAuthError extends Error {}

export function staffSessionReady(session: Session): boolean {
  return sessionAal(session.access_token) === "aal2";
}

export async function doorCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await activeClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new DoorAuthError("Signed out");
  const res = await fetch(functionUrl("door"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: backend.supabaseKey },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new DoorAuthError("Not authorised");
  if (!res.ok) throw new Error(`Door API ${res.status}`);
  return res.json();
}

export interface DoorIdentity {
  email: string;
  role: "super_admin" | "admin" | "door_staff" | "legacy" | null;
}

/** Ends the scanner session and any saved legacy door login. */
export async function signOutDoor() {
  activeSource = null;
  await Promise.all([adminAuth().auth.signOut(), doorAuth().auth.signOut()]);
}
