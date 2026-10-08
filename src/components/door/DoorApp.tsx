"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import QrScanner from "qr-scanner";
import { backend, backendConfigured } from "@/data/backend";
import { getFeaturedEvent } from "@/lib/events";
import { cn } from "@/lib/cn";
import {
  doorAuth,
  doorCall,
  DoorAuthError,
  type DoorStats,
  type GuestOrder,
  type ScanResult,
} from "./door-api";

const DEVICE_KEY = "omc-door-device";
/** After an admit, ignore the same code this long so a guest still holding it up isn't flagged as a repeat. */
const SAME_CODE_GRACE_MS = 6000;
const ADMIT_DISMISS_MS = 1600;

/**
 * Door staff console: shared login → live counts → camera scanner, plus a
 * guest list for manual check-in. Every decision is made server-side; this
 * page only displays the verdict.
 */
export function DoorApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!backendConfigured) return;
    const auth = doorAuth().auth;
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!backendConfigured) {
    return <Centered title="Door not set up" body="The ticketing backend isn't configured on this build yet." />;
  }
  if (session === undefined) return <Centered title="Loading…" />;
  if (!session) return <DoorLogin />;
  return <DoorConsole />;
}

function Centered({ title, body }: { title: string; body?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-4xl">{title}</p>
      {body && <p className="mt-3 max-w-[32ch] text-sm text-ivory-muted">{body}</p>}
    </main>
  );
}

function DoorLogin() {
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem(DEVICE_KEY) ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    localStorage.setItem(DEVICE_KEY, device.trim());
    const { error } = await doorAuth().auth.signInWithPassword({ email: backend.doorEmail, password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "Wrong password." : error.message);
  }

  const field =
    "mt-2 h-12 w-full rounded-md border border-ivory/20 bg-black/40 px-4 text-base text-ivory focus:border-gold focus:outline-none";

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <form onSubmit={submit} className="mx-auto w-full max-w-sm">
        <p className="eyebrow text-[0.6rem] tracking-[0.3em] text-gold">The One More Company</p>
        <h1 className="mt-3 font-display text-5xl">Door</h1>
        <label className="mt-8 block">
          <span className="eyebrow text-[0.6rem] text-ivory-muted">Door password</span>
          <input
            type="password"
            autoComplete="current-password"
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="mt-5 block">
          <span className="eyebrow text-[0.6rem] text-ivory-muted">This phone (optional)</span>
          <input
            className={field}
            placeholder="e.g. Front door — Vinay"
            value={device}
            maxLength={40}
            onChange={(e) => setDevice(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-8 h-14 w-full rounded-md bg-gold text-sm font-semibold uppercase tracking-[0.2em] text-rich disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Start scanning"}
        </button>
      </form>
    </main>
  );
}

function DoorConsole() {
  const event = getFeaturedEvent();
  const [tab, setTab] = useState<"scan" | "guests">("scan");
  const [stats, setStats] = useState<DoorStats | null>(null);
  const [offline, setOffline] = useState(false);

  const eventId = event?.id ?? "";

  const refreshStats = useCallback(async () => {
    if (!eventId) return;
    try {
      setStats(await doorCall<DoorStats>({ action: "stats", eventId }));
      setOffline(false);
    } catch (err) {
      if (err instanceof DoorAuthError) await doorAuth().auth.signOut();
      else setOffline(true);
    }
  }, [eventId]);

  useEffect(() => {
    const first = setTimeout(refreshStats, 0);
    const id = setInterval(refreshStats, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refreshStats]);

  if (!event) return <Centered title="No event" body="There's no featured event to check guests into." />;

  return (
    <main className="flex h-dvh flex-col bg-black">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-gold">{event.name}</p>
          <p className="mt-0.5 font-display text-3xl leading-none">
            {stats ? stats.inside : "–"}
            <span className="text-lg text-ivory/50"> / {stats ? stats.guests : "–"} inside</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => doorAuth().auth.signOut()}
          className="shrink-0 rounded-md border border-ivory/20 px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory/70"
        >
          Sign out
        </button>
      </header>
      {offline && (
        <p className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-black">
          No connection — scans can&apos;t be verified until it&apos;s back.
        </p>
      )}

      <nav className="grid grid-cols-2 border-y border-ivory/10">
        {(["scan", "guests"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "h-12 text-xs font-semibold uppercase tracking-[0.22em]",
              tab === t ? "bg-ivory/10 text-ivory" : "text-ivory/50",
            )}
          >
            {t === "scan" ? "Scan" : "Guest list"}
          </button>
        ))}
      </nav>

      <div className="relative min-h-0 flex-1">
        {tab === "scan" ? (
          <Scanner eventId={event.id} onScanned={refreshStats} />
        ) : (
          <Guests eventId={event.id} onAdmitted={refreshStats} />
        )}
      </div>
    </main>
  );
}

function device(): string | undefined {
  return localStorage.getItem(DEVICE_KEY) || undefined;
}

function Scanner({ eventId, onScanned }: { eventId: string; onScanned: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const lastAdmit = useRef<{ token: string; at: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [result, setResult] = useState<ScanResult | { outcome: "error" } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    clearTimeout(dismissTimer.current);
    setResult(null);
    busy.current = false;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handle = async (raw: string) => {
      const token = raw.trim().toLowerCase();
      if (busy.current) return;
      const recent = lastAdmit.current;
      if (recent && recent.token === token && Date.now() - recent.at < SAME_CODE_GRACE_MS) return;
      busy.current = true;
      try {
        const r = await doorCall<ScanResult>({ action: "scan", eventId, token, device: device() });
        if (r.outcome === "admitted") lastAdmit.current = { token, at: Date.now() };
        feedback(r.outcome === "admitted");
        setResult(r);
        if (r.outcome === "admitted") dismissTimer.current = setTimeout(dismiss, ADMIT_DISMISS_MS);
        onScanned();
      } catch (err) {
        if (err instanceof DoorAuthError) {
          await doorAuth().auth.signOut();
          return;
        }
        feedback(false);
        setResult({ outcome: "error" });
      }
    };

    const scanner = new QrScanner(video, (r) => void handle(r.data), {
      preferredCamera: "environment",
      maxScansPerSecond: 8,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
    });
    scanner.start().catch((err: unknown) => {
      setCameraError(
        String(err).includes("NotAllowed") || String(err).includes("permission")
          ? "Camera access was blocked. Allow the camera for this site in your browser settings, then reload."
          : "Couldn't start the camera. Close other apps using it and reload.",
      );
    });
    return () => {
      scanner.destroy();
      clearTimeout(dismissTimer.current);
    };
  }, [eventId, onScanned, dismiss]);

  return (
    <div className="absolute inset-0">
      <video ref={videoRef} muted playsInline className="size-full object-cover" />
      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center text-sm text-ivory-muted">
          {cameraError}
        </div>
      )}
      {!cameraError && !result && (
        <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
          Point at a ticket QR
        </p>
      )}
      {result && <Verdict result={result} onDismiss={dismiss} />}
    </div>
  );
}

const VERDICTS = {
  admitted: { bg: "bg-emerald-600", title: "Admit" },
  "already-used": { bg: "bg-amber-500", title: "Already in" },
  cancelled: { bg: "bg-red-600", title: "Refunded" },
  "wrong-event": { bg: "bg-red-600", title: "Wrong event" },
  "not-found": { bg: "bg-red-600", title: "Invalid ticket" },
  error: { bg: "bg-zinc-700", title: "No connection" },
} as const;

function Verdict({ result, onDismiss }: { result: ScanResult | { outcome: "error" }; onDismiss: () => void }) {
  const v = VERDICTS[result.outcome];
  const r = result.outcome === "error" ? null : result;
  const time = r?.checked_in_at
    ? new Date(r.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <button
      type="button"
      onClick={onDismiss}
      className={cn("absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white", v.bg)}
    >
      <span className="font-display text-7xl leading-none">{v.title}</span>
      {r && r.outcome === "admitted" && (
        <span className="mt-5 text-lg font-semibold">
          {r.tier_name}
          {r.guest_count && r.guest_count > 1 ? ` · guest ${r.guest_number} of ${r.guest_count}` : ""}
        </span>
      )}
      {r?.purchaser_name && <span className="mt-1 text-base opacity-90">{r.purchaser_name}</span>}
      {r?.outcome === "already-used" && (
        <span className="mt-5 text-lg font-semibold">
          Scanned at {time}
          {r.checked_in_by ? ` by ${r.checked_in_by.split("@")[0]}` : ""}
          <span className="mt-1 block text-sm font-normal opacity-90">Do not let in on this code.</span>
        </span>
      )}
      {result.outcome === "cancelled" && <span className="mt-5 text-lg">This ticket was refunded.</span>}
      {result.outcome === "wrong-event" && <span className="mt-5 text-lg">This ticket is for a different event.</span>}
      {result.outcome === "not-found" && <span className="mt-5 text-lg">Not a One More ticket.</span>}
      {result.outcome === "error" && <span className="mt-5 text-lg">Couldn&apos;t verify. Check signal and scan again.</span>}
      {result.outcome !== "admitted" && (
        <span className="mt-10 text-xs font-semibold uppercase tracking-[0.24em] opacity-80">Tap to scan next</span>
      )}
    </button>
  );
}

function Guests({ eventId, onAdmitted }: { eventId: string; onAdmitted: () => void }) {
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const search = useCallback(
    async (term: string) => {
      if (term.trim().length < 2) {
        setOrders([]);
        return;
      }
      try {
        const r = await doorCall<{ orders: GuestOrder[] }>({ action: "search", eventId, q: term });
        setOrders(r.orders);
      } catch {
        setMessage("Search failed — check connection.");
      }
    },
    [eventId],
  );

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  async function admit(ticketId: string) {
    setBusyId(ticketId);
    setMessage(null);
    try {
      const r = await doorCall<ScanResult>({ action: "admit", eventId, ticketId, device: device() });
      setMessage(r.outcome === "admitted" ? "Admitted." : `Not admitted: ${VERDICTS[r.outcome].title.toLowerCase()}.`);
      onAdmitted();
      await search(q);
    } catch {
      setMessage("Couldn't admit — check connection.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-4">
      <input
        type="search"
        placeholder="Search name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-12 w-full rounded-md border border-ivory/20 bg-ivory/5 px-4 text-base text-ivory focus:border-gold focus:outline-none"
      />
      {message && <p className="mt-3 text-sm text-gold">{message}</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.id} className="rounded-md border border-ivory/10 p-4">
            <p className="font-semibold">{o.purchaser_name ?? "(no name)"}</p>
            <p className="text-xs text-ivory/50">
              {o.purchaser_email} · {o.tier_name}
              {o.status !== "paid" ? ` · ${o.status}` : ""}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {o.tickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>Guest {t.guest_number}</span>
                  {t.status === "valid" ? (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => admit(t.id)}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] disabled:opacity-50"
                    >
                      Admit
                    </button>
                  ) : (
                    <span className={cn("text-xs uppercase tracking-[0.16em]", t.status === "cancelled" ? "text-red-400" : "text-ivory/50")}>
                      {t.status === "checked-in" && t.checked_in_at
                        ? `In · ${new Date(t.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : t.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

let audio: AudioContext | null = null;

/** Haptic + tone so staff don't have to read the screen in a loud room. */
function feedback(ok: boolean) {
  navigator.vibrate?.(ok ? 80 : [200, 80, 200]);
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 880 : 220;
    osc.type = ok ? "sine" : "square";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.15 : 0.45));
  } catch {}
}
