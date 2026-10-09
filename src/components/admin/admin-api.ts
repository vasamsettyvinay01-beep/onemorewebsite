import { functionUrl, backend } from "@/data/backend";
import { adminAuth } from "./admin-auth";

export class AdminApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function adminCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data } = await adminAuth().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminApiError("Sign in required.", 401);
  const res = await fetch(functionUrl("admin"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: backend.supabaseKey,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new AdminApiError(body.error ?? "Request failed.", res.status, body.code);
  return body as T;
}

export async function reportFailedSignIn(email: string) {
  await fetch(functionUrl("admin"), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: backend.supabaseKey },
    body: JSON.stringify({ action: "login_failed", email }),
  }).catch(() => undefined);
}
