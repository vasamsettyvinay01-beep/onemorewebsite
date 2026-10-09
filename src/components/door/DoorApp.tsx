"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import QrScanner from "qr-scanner";
import { backend, backendConfigured } from "@/data/backend";
import { getFeaturedEvent } from "@/lib/events";
import { cn } from "@/lib/cn";
import { adminAuth, sessionAal } from "@/components/admin/admin-auth";
import {
  doorAuth,
  doorCall,
  DoorAuthError,
  setDoorSessionSource,
  signOutDoor,
  staffSessionReady,
  type DoorIdentity,
  type DoorSessionSource,
  type DoorStats,
  type GuestOrder,
  type ScanResult,
} from "./door-api";

const DEVICE_KEY = "omc-door-device";
/** After an admit, ignore the same code this long so a guest still holding it up isn't flagged as a repeat. */
const SAME_CODE_GRACE_MS = 6000;
const ADMIT_DISMISS_MS = 1600;

/**
 * Door staff console. An existing privileged aal2 session opens the scanner.
 * Otherwise the operator signs in here. The server, not this page, decides
 * whether that session may scan.
 */
export function DoorApp() {
  const [phase, setPhase] = useState<"loading" | "login" | "mfa" | "ready">("loading");
  const [source, setSource] = useState<DoorSessionSource | null>(null);
  const [identity, setIdentity] = useState("");
  const [armSetup, setArmSetup] = useState(false);

  const openScanner = useCallback((next: DoorSessionSource, email: string) => {
    setDoorSessionSource(next);
    setSource(next);
    setIdentity(email);
    setPhase("ready");
  }, []);

  useEffect(() => {
    if (!backendConfigured) return;
    let cancel = false;
    (async () => {
      await doorAuth().auth.signOut();
      const staff = (await adminAuth().auth.getSession()).data.session;
      if (cancel) return;
      if (staff) {
        if (staffSessionReady(staff)) openScanner("staff", staff.user.email ?? "");
        else {
          setDoorSessionSource("staff");
          setSource("staff");
          setIdentity(staff.user.email ?? "");
          setPhase("mfa");
        }
        return;
      }
      if (!cancel) setPhase("login");
    })();
    return () => {
      cancel = true;
    };
  }, [openScanner]);

  useEffect(() => {
    if (phase !== "ready" || !source) return;
    const client = source === "staff" ? adminAuth() : doorAuth();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setDoorSessionSource(null);
        setSource(null);
        setIdentity("");
        setPhase("login");
      }
    });
    return () => data.subscription.unsubscribe();
  }, [phase, source]);

  if (!backendConfigured) {
    return <Centered title="Door not set up" body="The ticketing backend isn't configured on this build yet." />;
  }
  if (phase === "loading") return <Centered title="Loading…" />;
  if (phase !== "ready") {
    return (
      <DoorLogin
        phase={phase}
        identity={identity}
        armSetup={armSetup}
        onReady={openScanner}
        onNeedsMfa={(email) => {
          setArmSetup(true);
          setDoorSessionSource("staff");
          setSource("staff");
          setIdentity(email);
          setPhase("mfa");
        }}
        onCancel={async () => {
          setArmSetup(false);
          await signOutDoor();
          setSource(null);
          setIdentity("");
          setPhase("login");
        }}
      />
    );
  }
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

function DoorLogin({
  phase,
  identity,
  armSetup,
  onReady,
  onNeedsMfa,
  onCancel,
}: {
  phase: "login" | "mfa";
  identity: string;
  armSetup: boolean;
  onReady: (source: DoorSessionSource, email: string) => void;
  onNeedsMfa: (email: string) => void;
  onCancel: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem(DEVICE_KEY) ?? ""));
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase !== "mfa") return;
    let cancel = false;
    (async () => {
      const factors = await adminAuth().auth.mfa.listFactors();
      const totp = factors.data?.totp?.[0];
      if (cancel) return;
      if (!totp) {
        if (!armSetup) {
          setError("This account needs an authenticator. Sign in again to set it up.");
          return;
        }
        const enrolled = await adminAuth().auth.mfa.enroll({ factorType: "totp", friendlyName: "One More door" });
        if (cancel) return;
        if (enrolled.error || !enrolled.data) {
          setError("Could not start authenticator setup.");
          return;
        }
        setFactorId(enrolled.data.id);
        setQr(enrolled.data.totp.qr_code);
        return;
      }
      setFactorId(totp.id);
      const challenge = await adminAuth().auth.mfa.challenge({ factorId: totp.id });
      if (!cancel && challenge.data) setChallengeId(challenge.data.id);
    })();
    return () => {
      cancel = true;
    };
  }, [armSetup, phase]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    localStorage.setItem(DEVICE_KEY, device.trim());
    const attempted = email.trim().toLowerCase();
    const legacy = attempted === backend.doorEmail.toLowerCase();
    const client = legacy ? doorAuth() : adminAuth();
    const { data, error: signError } = await client.auth.signInWithPassword({ email: attempted, password });
    setPassword("");
    if (signError || !data.session) {
      setError("Sign-in failed.");
      setBusy(false);
      return;
    }
    const signedIn = data.session.user.email ?? attempted;
    if (legacy) {
      onReady("door", signedIn);
      setBusy(false);
      return;
    }
    if (sessionAal(data.session.access_token) === "aal2") {
      onReady("staff", signedIn);
      setBusy(false);
      return;
    }
    setBusy(false);
    onNeedsMfa(signedIn);
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
    const session = (await adminAuth().auth.getSession()).data.session;
    if (!session || sessionAal(session.access_token) !== "aal2") {
      setError("Authenticator verification is required.");
      setBusy(false);
      return;
    }
    onReady("staff", session.user.email ?? identity);
    setBusy(false);
  }

  const field =
    "mt-2 h-12 w-full rounded-md border border-ivory/20 bg-black/40 px-4 text-base text-ivory focus:border-gold focus:outline-none";

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <form onSubmit={phase === "mfa" ? verify : submit} className="mx-auto w-full max-w-sm">
        <p className="eyebrow text-[0.6rem] tracking-[0.3em] text-gold">The One More Company</p>
        <h1 className="mt-3 font-display text-5xl">Door</h1>
        {phase === "mfa" ? (
          <>
            <p className="mt-4 text-sm text-ivory-muted">
              Authenticator required{identity ? ` for ${identity}` : ""}.
            </p>
            {qr && (
              <object data={qr} type="image/svg+xml" aria-label="Authenticator setup QR" className="mt-6 size-44 bg-white p-2">
                Authenticator setup code
              </object>
            )}
            <label className="mt-6 block">
              <span className="eyebrow text-[0.6rem] text-ivory-muted">Authenticator code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                className={field}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <>
            <label className="mt-8 block">
              <span className="eyebrow text-[0.6rem] text-ivory-muted">Email</span>
              <input
                type="email"
                autoComplete="username"
                className={field}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="mt-5 block">
              <span className="eyebrow text-[0.6rem] text-ivory-muted">Password</span>
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
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || (phase === "mfa" ? !code : !email || !password)}
          className="mt-8 h-14 w-full rounded-md bg-gold text-sm font-semibold uppercase tracking-[0.2em] text-rich disabled:opacity-50"
        >
          {busy ? "Checking…" : phase === "mfa" ? "Verify" : "Continue"}
        </button>
        {phase === "mfa" && (
          <button type="button" className="mt-4 w-full text-sm text-ivory/50" onClick={() => void onCancel()}>
            Cancel and sign out
          </button>
        )}
      </form>
    </main>
  );
}

const ROLE_LABEL: Record<NonNullable<DoorIdentity["role"]>, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  door_staff: "Door staff",
  legacy: "Door",
};

function DoorConsole() {
  const [who, setWho] = useState<DoorIdentity | null>(null);
  const event = getFeaturedEvent();
  const [tab, setTab] = useState<"scan" | "guests">("scan");
  const [stats, setStats] = useState<DoorStats | null>(null);
  const [offline, setOffline] = useState(false);

  const eventId = event?.id ?? "";

  const refreshStats = useCallback(async () => {
    if (!eventId) return;
    try {
      const [nextStats, nextWho] = await Promise.all([
        doorCall<DoorStats>({ action: "stats", eventId }),
        doorCall<DoorIdentity>({ action: "session" }),
      ]);
      setStats(nextStats);
      setWho(nextWho);
      setOffline(false);
    } catch (err) {
      if (err instanceof DoorAuthError) await signOutDoor();
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
          <p className="mt-1 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-ivory/40">Signed in as</p>
          <p className="truncate text-[0.72rem] text-ivory">{who?.email ?? "Checking identity…"}</p>
          {who?.role && (
            <p className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-gold/80">
              Role · {ROLE_LABEL[who.role]}
            </p>
          )}
          <p className="mt-0.5 font-display text-3xl leading-none">
            {stats ? stats.inside : "–"}
            <span className="text-lg text-ivory/50"> / {stats ? stats.guests : "–"} inside</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOutDoor()}
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
          await signOutDoor();
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
  admitted: { bg: "bg-emerald-600", title: "Valid" },
  "already-used": { bg: "bg-amber-500", title: "Already used" },
  cancelled: { bg: "bg-red-600", title: "Cancelled" },
  "wrong-event": { bg: "bg-red-600", title: "Wrong event" },
  "not-found": { bg: "bg-red-600", title: "Invalid" },
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
          Check-in successful
          <span className="mt-1 block text-base font-normal">
            {r.tier_name}
            {r.guest_count && r.guest_count > 1 ? ` · guest ${r.guest_number} of ${r.guest_count}` : ""}
          </span>
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
    } catch (err) {
      if (err instanceof DoorAuthError) {
        await signOutDoor();
        return;
      }
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
