"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminAuth, sessionAal } from "./admin-auth";
import { adminCall, AdminApiError, reportFailedSignIn } from "./admin-api";
import type { AdminEvent, StaffRole } from "./types";
import { roleLabel } from "./format";
import { cn } from "@/lib/cn";
import { ErrorNote, inputClass } from "./ui";

const EVENT_KEY = "omc-admin-event";

interface AdminContextValue {
  email: string;
  role: StaffRole;
  events: AdminEvent[];
  eventId: string;
  event: AdminEvent | null;
  setEventId: (id: string) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("Admin context missing");
  return value;
}

const NAV = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/check-in", label: "Check-in" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/staff", label: "Staff" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"loading" | "login" | "mfa" | "ready" | "denied">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<{ email: string; role: StaffRole } | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventId, setEventIdState] = useState("");

  async function reset() {
    await adminAuth().auth.signOut();
    setIdentity(null);
    setFactorId(null);
    setChallengeId(null);
    setQr(null);
    setCode("");
    setPassword("");
    setPhase("login");
  }

  async function enter() {
    const who = await adminCall<{ email: string; role: StaffRole }>("whoami");
    if (who.role !== "admin" && who.role !== "super_admin") throw new AdminApiError("Not authorised", 403);
    const listed = await adminCall<{ events: AdminEvent[] }>("events");
    const stored = window.sessionStorage.getItem(EVENT_KEY);
    const nextId = listed.events.some((event) => event.id === stored) ? stored! : listed.events[0]?.id ?? "";
    setIdentity(who);
    setEvents(listed.events);
    setEventIdState(nextId);
    setPhase("ready");
    setError(null);
  }

  useEffect(() => {
    let cancel = false;
    adminAuth()
      .auth.getSession()
      .then(async ({ data }) => {
        if (cancel) return;
        const token = data.session?.access_token;
        if (!token) {
          setPhase("login");
          return;
        }
        if (sessionAal(token) !== "aal2") {
          const factors = await adminAuth().auth.mfa.listFactors();
          const totp = factors.data?.totp?.[0];
          if (totp) {
            setFactorId(totp.id);
            const challenge = await adminAuth().auth.mfa.challenge({ factorId: totp.id });
            if (challenge.data) setChallengeId(challenge.data.id);
          }
          setPhase("mfa");
          return;
        }
        try {
          await enter();
        } catch (err) {
          if (cancel) return;
          if (err instanceof AdminApiError && err.code === "mfa_required") setPhase("mfa");
          else {
            await adminAuth().auth.signOut();
            setError("This account cannot open operations.");
            setPhase("denied");
          }
        }
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const attempted = email;
    const { error: signError } = await adminAuth().auth.signInWithPassword({ email: attempted, password });
    setPassword("");
    if (signError) {
      await reportFailedSignIn(attempted);
      await reset();
      setError("Sign-in failed.");
      setBusy(false);
      return;
    }
    const factors = await adminAuth().auth.mfa.listFactors();
    const totp = factors.data?.totp?.[0];
    if (!totp) {
      const enrolled = await adminAuth().auth.mfa.enroll({ factorType: "totp", friendlyName: "One More operations" });
      if (enrolled.error || !enrolled.data) {
        await reset();
        setError("Could not start authenticator setup.");
        setBusy(false);
        return;
      }
      setFactorId(enrolled.data.id);
      setQr(enrolled.data.totp.qr_code);
      setPhase("mfa");
      setBusy(false);
      return;
    }
    setFactorId(totp.id);
    const challenge = await adminAuth().auth.mfa.challenge({ factorId: totp.id });
    if (challenge.error || !challenge.data) {
      setError("Could not start verification.");
      setBusy(false);
      return;
    }
    setChallengeId(challenge.data.id);
    setPhase("mfa");
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    let currentChallenge = challengeId;
    if (!currentChallenge) {
      const challenge = await adminAuth().auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) {
        setError("Could not start verification.");
        setBusy(false);
        return;
      }
      currentChallenge = challenge.data.id;
      setChallengeId(currentChallenge);
    }
    const verified = await adminAuth().auth.mfa.verify({ factorId, challengeId: currentChallenge, code });
    if (verified.error) {
      setError("That code was not accepted.");
      setBusy(false);
      return;
    }
    try {
      await enter();
    } catch (err) {
      await adminAuth().auth.signOut();
      setError(err instanceof AdminApiError && err.status === 403 ? "This account cannot open operations." : "Could not open operations.");
      setPhase("denied");
    }
    setBusy(false);
  }

  const chooseEvent = useCallback((id: string) => {
    setEventIdState(id);
    window.sessionStorage.setItem(EVENT_KEY, id);
  }, []);

  const event = events.find((item) => item.id === eventId) ?? null;
  const value = useMemo<AdminContextValue | null>(
    () => (identity ? { email: identity.email, role: identity.role, events, eventId, event, setEventId: chooseEvent } : null),
    [identity, events, eventId, event, chooseEvent],
  );

  if (phase === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#101210] text-sm text-white/60">
        Loading operations…
      </main>
    );
  }

  if (phase !== "ready" || !value) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#101210] px-4 text-[#eceae4]">
        <form onSubmit={phase === "mfa" ? verify : signIn} className="w-full max-w-sm">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-white/45">The One More Company</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="mt-1 text-sm text-white/50">Staff sign-in with an authenticator.</p>
          {phase !== "mfa" && (
            <>
              <label className="mt-6 block text-xs text-white/55" htmlFor="ops-email">
                Email
              </label>
              <input id="ops-email" className={cn(inputClass, "mt-1")} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label className="mt-3 block text-xs text-white/55" htmlFor="ops-password">
                Password
              </label>
              <input id="ops-password" className={cn(inputClass, "mt-1")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          )}
          {qr && (
            <object data={qr} type="image/svg+xml" aria-label="Authenticator setup QR" className="mt-5 size-44 bg-white p-2">
              Authenticator setup code
            </object>
          )}
          {phase === "mfa" && (
            <>
              <label className="mt-4 block text-xs text-white/55" htmlFor="ops-code">
                Authenticator code
              </label>
              <input id="ops-code" className={cn(inputClass, "mt-1")} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </>
          )}
          {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
          {phase !== "denied" && (
            <button className="mt-5 h-10 w-full rounded-md bg-[#eceae4] text-sm font-semibold text-[#141513]" type="submit" disabled={busy}>
              {busy ? "Checking…" : phase === "mfa" ? "Verify" : "Continue"}
            </button>
          )}
          {phase === "mfa" && (
            <button type="button" className="mt-3 w-full text-sm text-white/50" onClick={() => void reset()}>
              Cancel and sign out
            </button>
          )}
          {phase === "denied" && (
            <button type="button" className="mt-5 h-10 w-full rounded-md border border-white/15 text-sm" onClick={() => { setError(null); setPhase("login"); }}>
              Back to sign in
            </button>
          )}
        </form>
      </main>
    );
  }

  return (
    <AdminContext.Provider value={value}>
      <div className="min-h-dvh bg-[#101210] text-[#eceae4] md:grid md:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="border-b border-white/10 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0">
          <div className="flex items-center justify-between gap-3 px-3 py-3 md:block">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.16em] text-white/40">One More</p>
              <p className="text-sm font-semibold">Operations</p>
            </div>
            <button type="button" className="text-xs text-white/55 md:mt-3" onClick={() => void reset()}>
              Sign out
            </button>
          </div>
          <label className="block px-3 pb-3 text-[0.65rem] uppercase tracking-[0.14em] text-white/40">
            Event
            <select className={cn(inputClass, "mt-1")} value={eventId} onChange={(e) => chooseEvent(e.target.value)}>
              {events.length === 0 && <option value="">No events</option>}
              {events.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:px-2">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={cn("shrink-0 rounded-md px-2.5 py-2 text-sm", active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5")}>
                  {item.label}
                </Link>
              );
            })}
            <a href="/door" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md px-2.5 py-2 text-sm text-white/55 hover:bg-white/5">
              Scanner access — verify
            </a>
          </nav>
          <p className="hidden px-3 py-3 text-xs text-white/40 md:block">
            {roleLabel(value.role)}
            <span className="mt-0.5 block truncate">{value.email}</span>
          </p>
        </aside>
        <div className="min-w-0 px-3 py-4 sm:px-5 md:px-8 md:py-6">{children}</div>
      </div>
    </AdminContext.Provider>
  );
}
