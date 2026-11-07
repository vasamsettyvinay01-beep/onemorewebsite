"use client";

/**
 * The time the site presents by: the web server's clock, not the visitor's.
 * A device set to the wrong day or time cannot change which event leads the
 * page or bring back a buy button. Sales are enforced by the checkout function
 * either way; this only keeps what is shown in step with it.
 *
 * Development only: `?lifecycle-now=2026-11-08T01:15:00-06:00` starts the clock
 * at that instant. Production builds strip the branch, so visitors cannot use it.
 */

let offsetMs = 0;
let started = false;
const listeners = new Set<() => void>();

export function siteNow(): number {
  return Date.now() + offsetMs;
}

function notify() {
  for (const listener of listeners) listener();
}

async function syncWithServer() {
  try {
    const sent = Date.now();
    const res = await fetch(`${window.location.origin}/`, { method: "HEAD", cache: "no-store" });
    const received = Date.now();
    const served = Date.parse(res.headers.get("date") ?? "");
    if (!Number.isFinite(served)) return;
    // The Date header is truncated to the second; aim at the middle of it.
    offsetMs = served + 500 - (sent + received) / 2;
    notify();
  } catch {
    // Offline or blocked: keep the device clock.
  }
}

function simulatedStart(): number | null {
  if (process.env.NODE_ENV !== "development") return null;
  const raw = new URLSearchParams(window.location.search).get("lifecycle-now");
  const at = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const simulated = simulatedStart();
  if (simulated !== null) offsetMs = simulated - Date.now();
  else void syncWithServer();
  setInterval(notify, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (simulated === null) void syncWithServer();
    notify();
  });
}

export function subscribeSiteClock(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
