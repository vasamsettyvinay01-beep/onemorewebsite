"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { events } from "@/data/events";
import { backendConfigured, functionUrl } from "@/data/backend";
import { formatChapter, formatEventDate, formatEventPlace, formatEventTime } from "@/lib/events";
import { eventThemeToStyle } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface TicketRow {
  guest_number: number;
  token: string;
  status: "valid" | "checked-in" | "cancelled";
  checked_in_at: string | null;
}

interface OrderView {
  event_id: string;
  tier_name: string;
  purchaser_name: string | null;
  status: "paid" | "refunded" | "partially-refunded";
  access_token: string;
  tickets: TicketRow[];
}

type State =
  | { kind: "loading" }
  | { kind: "issuing" }
  | { kind: "missing" }
  | { kind: "ready"; order: OrderView; qr: Record<string, string> };

/** Right after checkout the webhook may lag the redirect by a few seconds. */
const POLL_MS = 2000;
const POLL_TRIES = 30;

export function TicketsView() {
  const params = useSearchParams();
  const accessToken = params.get("o");
  const sessionId = params.get("session");
  const unusable = !backendConfigured || (!accessToken && !sessionId);
  const [fetched, setState] = useState<State>({ kind: "loading" });
  const state: State = unusable ? { kind: "missing" } : fetched;

  useEffect(() => {
    if (unusable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const query = accessToken ? `o=${encodeURIComponent(accessToken)}` : `session=${encodeURIComponent(sessionId!)}`;

    async function load(attempt: number) {
      try {
        const res = await fetch(`${functionUrl("ticket-view")}?${query}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404 && sessionId && !accessToken && attempt < POLL_TRIES) {
          setState({ kind: "issuing" });
          timer = setTimeout(() => load(attempt + 1), POLL_MS);
          return;
        }
        if (!res.ok) {
          setState({ kind: "missing" });
          return;
        }
        const order: OrderView = await res.json();
        const qr: Record<string, string> = {};
        await Promise.all(
          order.tickets.map(async (t) => {
            qr[t.token] = await QRCode.toString(t.token, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
          }),
        );
        if (cancelled) return;
        // Swap the one-time Stripe session for the permanent ticket link.
        if (!accessToken) window.history.replaceState(null, "", `?o=${order.access_token}`);
        setState({ kind: "ready", order, qr });
      } catch {
        if (cancelled) return;
        if (attempt < POLL_TRIES) timer = setTimeout(() => load(attempt + 1), POLL_MS);
        else setState({ kind: "missing" });
      }
    }

    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, sessionId, unusable]);

  const event = state.kind === "ready" ? events.find((e) => e.id === state.order.event_id) : undefined;
  const themeStyle = event ? eventThemeToStyle(event.theme) : undefined;

  return (
    <main style={themeStyle} className="flex min-h-dvh flex-col items-center px-5 pb-16 pt-10">
      <div className="w-full max-w-md">
        <Link href="/" className="eyebrow text-[0.6rem] tracking-[0.3em] text-gold">
          {brand.name}
        </Link>

        {(state.kind === "loading" || state.kind === "issuing") && (
          <div className="mt-24 text-center">
            <span aria-hidden className="mx-auto block size-10 animate-spin rounded-full border-2 border-ivory/15 border-t-gold" />
            <p className="mt-6 font-display text-3xl">
              {state.kind === "issuing" ? "Payment received." : "Loading tickets…"}
            </p>
            {state.kind === "issuing" && (
              <p className="mt-2 text-sm text-ivory-muted">Issuing your tickets — this takes a few seconds.</p>
            )}
          </div>
        )}

        {state.kind === "missing" && (
          <div className="mt-24 text-center">
            <p className="font-display text-4xl">Tickets not found.</p>
            <p className="mx-auto mt-4 max-w-[32ch] text-sm leading-relaxed text-ivory-muted">
              {sessionId
                ? "Your payment went through — your tickets are on their way to your inbox. Use the link in that email."
                : "Check the link in your ticket email, or message us on WhatsApp and we'll sort it."}
            </p>
            <Button href="/" variant="ghost" className="mt-8">
              Back to the site
            </Button>
          </div>
        )}

        {state.kind === "ready" && (
          <>
            <div className="mt-8">
              {event?.chapter !== undefined && (
                <p className="eyebrow text-[0.6rem] tracking-[0.3em] text-ivory/50">{formatChapter(event.chapter)}</p>
              )}
              <h1 className="mt-2 font-display text-[3.2rem] leading-[0.9]">{event?.name ?? "Your tickets"}</h1>
              {event && (
                <p className="mt-3 text-sm leading-relaxed text-ivory-muted">
                  {[formatEventDate(event), formatEventTime(event)].filter(Boolean).join(" · ")}
                  <br />
                  {formatEventPlace(event)}
                </p>
              )}
              <p className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-(--ev-accent,var(--color-gold))">
                {state.order.tier_name} · {state.order.tickets.length}{" "}
                {state.order.tickets.length === 1 ? "guest" : "guests"}
                {state.order.purchaser_name ? ` · ${state.order.purchaser_name}` : ""}
              </p>
            </div>

            {state.order.status === "refunded" && (
              <p role="alert" className="mt-6 border border-(--ev-accent,var(--color-gold)) px-4 py-3 text-sm">
                This order was refunded. These tickets no longer admit.
              </p>
            )}

            <p className="mt-6 text-sm leading-relaxed text-ivory-muted">
              Turn your brightness up and show one code per guest at the door. Each code admits one person, once —
              don&apos;t post or share them. Screenshot this page in case the venue has no signal.
            </p>

            <ul className="mt-6 flex flex-col gap-5">
              {state.order.tickets.map((t) => (
                <li key={t.token} className="overflow-hidden rounded-md border border-gold/30 bg-[#0d0e0d]">
                  <div className="relative bg-white p-5">
                    <div
                      aria-label={`QR code for guest ${t.guest_number}`}
                      role="img"
                      className={cn("mx-auto aspect-square w-full max-w-72", t.status !== "valid" && "opacity-15")}
                      dangerouslySetInnerHTML={{ __html: state.qr[t.token] }}
                    />
                    {t.status !== "valid" && (
                      <p className="absolute inset-0 flex items-center justify-center text-center font-display text-3xl text-rich">
                        {t.status === "checked-in" ? "Checked in" : "Cancelled"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="eyebrow text-[0.58rem] tracking-[0.24em] text-gold">
                      Guest {t.guest_number} of {state.order.tickets.length}
                    </span>
                    <span className="font-mono text-[0.6rem] tracking-[0.2em] text-ivory/45">
                      {t.status === "checked-in" && t.checked_in_at
                        ? new Date(t.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : `No. ${t.token.slice(-6).toUpperCase()}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
