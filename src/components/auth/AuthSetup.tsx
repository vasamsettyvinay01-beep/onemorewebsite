"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { backend } from "@/data/backend";

let client: SupabaseClient | null = null;
function auth(): SupabaseClient {
  client ??= createClient(backend.supabaseUrl, backend.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit",
      storageKey: "omc-staff-setup",
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
    },
  });
  return client;
}

function invitationErrorInUrl(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return Boolean(
    hash.get("error") ||
      hash.get("error_code") ||
      hash.get("error_description") ||
      query.get("error") ||
      query.get("error_code") ||
      query.get("error_description"),
  );
}

export function AuthSetup() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const expiredLink = invitationErrorInUrl();
    auth()
      .auth.getSession()
      .then(({ data }) => {
        const nextEmail = data.session?.user.email ?? null;
        setEmail(nextEmail);
        setExpired(expiredLink && !nextEmail);
        setReady(true);
      })
      .catch(() => {
        setExpired(expiredLink);
        setReady(true);
      });
  }, []);

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12 || password !== confirm) {
      setError("Use a password of at least 12 characters and enter it twice.");
      return;
    }
    const saved = await auth().auth.updateUser({ password });
    setPassword("");
    setConfirm("");
    if (saved.error || !saved.data.user) {
      setError("That password was not accepted. Choose a different one.");
      return;
    }
    const enrolled = await auth().auth.mfa.enroll({ factorType: "totp", friendlyName: "One More staff" });
    if (enrolled.error || !enrolled.data) {
      setError("Could not start authenticator setup.");
      return;
    }
    setFactorId(enrolled.data.id);
    setQr(enrolled.data.totp.qr_code);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    const challenge = await auth().auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      setError("Could not start verification. Request a new code.");
      return;
    }
    const verified = await auth().auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    setCode("");
    if (verified.error) {
      setError("That authenticator code was not accepted.");
      return;
    }
    await auth().auth.signOut();
    setDone(true);
    setQr(null);
  }

  if (!ready) return <main className="min-h-dvh bg-zinc-950 p-8 text-zinc-200">Loading…</main>;

  return (
    <main className="min-h-dvh bg-zinc-950 px-6 py-16 text-zinc-100">
      <form onSubmit={qr ? verify : savePassword} className="mx-auto max-w-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">The One More Company</p>
        <h1 className="mt-2 text-3xl font-semibold">SET UP YOUR ACCOUNT</h1>
        {expired && (
          <p className="mt-6 text-sm text-zinc-300">This invitation has expired or is no longer valid. Request a new invitation.</p>
        )}
        {!email && !expired && (
          <p className="mt-6 text-sm text-zinc-300">Open the invitation link sent to your email to continue.</p>
        )}
        {email && !qr && !done && (
          <>
            <p className="mt-6 text-sm text-zinc-300">Choose a password for {email}. It stays with Supabase Auth.</p>
            <label className="mt-4 block text-sm text-zinc-300" htmlFor="staff-password">
              Password
            </label>
            <input
              id="staff-password"
              className="mt-1 h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-3"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label className="mt-3 block text-sm text-zinc-300" htmlFor="staff-password-confirm">
              Confirm password
            </label>
            <input
              id="staff-password-confirm"
              className="mt-1 h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-3"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </>
        )}
        {qr && <img src={qr} alt="Authenticator setup QR" className="mt-6 size-48 bg-white p-2" />}
        {qr && (
          <label className="mt-4 block text-sm text-zinc-300" htmlFor="staff-mfa-code">
            6-digit code
          </label>
        )}
        {qr && (
          <input
            id="staff-mfa-code"
            className="mt-1 h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-3"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        )}
        {done && (
          <p className="mt-6 text-sm text-zinc-300">
            Password and authenticator are set. Sign in again and enter a new authenticator code before using admin or the scanner.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {email && !done && (
          <button className="mt-6 h-11 w-full rounded bg-zinc-100 text-sm font-semibold text-zinc-950" type="submit">
            {qr ? "Verify code" : "Continue"}
          </button>
        )}
      </form>
    </main>
  );
}
