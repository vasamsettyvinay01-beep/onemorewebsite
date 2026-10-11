"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { events } from "@/data/events";
import { backendConfigured, functionUrl } from "@/data/backend";
import { formatChapter, formatEventTime } from "@/lib/events";
import { cn } from "@/lib/cn";
import type { OneMoreEvent } from "@/types/event";
import { DiwaliFireworks } from "@/components/ticketing/DiwaliFireworks";
import { TicketActions } from "@/components/ticketing/TicketActions";
import { passStanding } from "@/lib/pass-standing";

interface TicketRow {
  guest_number: number;
  token: string;
  status: "valid" | "checked-in" | "cancelled";
  checked_in_at: string | null;
  guest_name: string | null;
  share: "none" | "ready" | "opened";
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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "vinay kumar" / "VINAY KUMAR" → "Vinay Kumar"; mixed case (e.g. "McKay") is left alone. */
function properName(name: string | null): string | null {
  if (!name?.trim()) return null;
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function longDate(event: OneMoreEvent): string | undefined {
  if (!event.date) return undefined;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${event.date}T12:00:00`),
  );
}

export function TicketsView() {
  const params = useSearchParams();
  const accessToken = params.get("o");
  const sessionId = params.get("session");
  const unusable = !backendConfigured || (!accessToken && !sessionId);
  const [fetched, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const qrCache = useRef<Record<string, string>>({});
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
          setState((current) => (current.kind === "ready" ? current : { kind: "missing" }));
          return;
        }
        const order: OrderView = await res.json();
        const qr = { ...qrCache.current };
        await Promise.all(
          order.tickets.map(async (t) => {
            if (qr[t.token] || !/^[0-9a-f]{36}$/i.test(t.token)) return;
            const svg = await QRCode.toString(t.token, {
              type: "svg",
              margin: 0,
              errorCorrectionLevel: "M",
              color: { dark: "#0F100F", light: "#F4F1EA" },
            });
            if (svg.trimStart().startsWith("<svg")) qr[t.token] = svg;
          }),
        );
        if (cancelled) return;
        qrCache.current = qr;
        // Swap the one-time Stripe session for the permanent ticket link.
        if (!accessToken) window.history.replaceState(null, "", `?o=${order.access_token}`);
        setState({ kind: "ready", order, qr });
      } catch {
        if (cancelled) return;
        if (attempt < POLL_TRIES) timer = setTimeout(() => load(attempt + 1), POLL_MS);
        else setState((current) => (current.kind === "ready" ? current : { kind: "missing" }));
      }
    }

    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, sessionId, unusable, reloadKey]);

  const watchParty = state.kind === "ready" && state.order.tickets.some((ticket) => ticket.share === "ready" || ticket.share === "opened");
  useEffect(() => {
    if (!watchParty) return;
    const id = setInterval(() => setReloadKey((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, [watchParty]);

  return (
    <main className="fixed inset-0 flex flex-col items-center overflow-hidden overscroll-none bg-[#0A0A09]">
      {state.kind === "ready" && <DiwaliFireworks />}
      <div className="flex h-full w-full max-w-[26.5rem] flex-col px-3.5 py-2">
        <header className="flex shrink-0 flex-col items-center">
          <Link href="/" aria-label={brand.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo.sealPath} alt="" width={28} height={28} className="size-7" />
          </Link>
          <p className="mt-1.5 text-[0.5rem] font-semibold uppercase tracking-[0.42em] text-gold">{brand.name}</p>
        </header>

        {(state.kind === "loading" || state.kind === "issuing") && (
          <Waiting issuing={state.kind === "issuing"} />
        )}
        {state.kind === "missing" && <Missing paid={!!sessionId} />}
        {state.kind === "ready" && <Passes order={state.order} qr={state.qr} onChanged={() => setReloadKey((n) => n + 1)} />}
      </div>
    </main>
  );
}

function Waiting({ issuing }: { issuing: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span aria-hidden className="relative block size-14">
        <span className="absolute inset-0 rounded-full border border-gold/15" />
        <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-gold [animation-duration:1.4s]" />
      </span>
      <p className="mt-8 font-display text-[2.4rem] leading-none text-ivory">
        {issuing ? (
          <>
            Payment <span className="italic text-gold">received.</span>
          </>
        ) : (
          "One moment…"
        )}
      </p>
      <p className="mt-4 text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-ivory/45">
        {issuing ? "Issuing your passes" : "Retrieving your passes"}
      </p>
    </div>
  );
}

function Missing({ paid }: { paid: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-[2.4rem] leading-none text-ivory">
        {paid ? (
          <>
            Your passes are <span className="italic text-gold">on their way.</span>
          </>
        ) : (
          "Passes not found."
        )}
      </p>
      <p className="mt-5 max-w-[30ch] text-sm leading-relaxed text-ivory/55">
        {paid
          ? "Your payment is confirmed. Your passes will arrive by email — open the link inside to view them here."
          : "Please use the link in your confirmation email, or reply to it and we'll take care of you."}
      </p>
      <Link
        href="/"
        className="mt-10 border border-gold/70 px-8 py-3.5 text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold hover:text-rich"
      >
        Return home
      </Link>
    </div>
  );
}

function statusLabel(ticketStatus: TicketRow["status"] | undefined, orderStatus: OrderView["status"]): string {
  return passStanding(ticketStatus, orderStatus);
}

function passName(ticket: TicketRow, purchaser: string | null): string | null {
  return properName(ticket.guest_name) ?? (ticket.guest_number === 1 ? purchaser : null);
}

function Passes({ order, qr, onChanged }: { order: OrderView; qr: Record<string, string>; onChanged: () => void }) {
  const event = events.find((e) => e.id === order.event_id);
  const total = order.tickets.length;
  const holder = properName(order.purchaser_name);
  const first = holder?.split(" ")[0];
  const date = event ? longDate(event) : undefined;
  const venue = event?.venue;
  const [index, setIndex] = useState(0);
  const ticket = order.tickets[Math.min(index, total - 1)];
  const when = [date?.replace(/, \d{4}$/, ""), event ? formatEventTime(event) : undefined].filter(Boolean).join(" · ");
  const named = ticket ? passName(ticket, holder) : null;
  const senderName = first ?? "A guest";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="shrink-0 px-1 pt-1.5 text-center">
        <p className="text-[0.48rem] font-semibold uppercase tracking-[0.34em] text-gold">
          {event?.chapter !== undefined ? `${formatChapter(event.chapter)} · ` : ""}
          {statusLabel(ticket?.status, order.status)}
        </p>
        {first && <p className="mt-1 font-display text-[1.15rem] italic leading-none text-gold-soft">Dear {first},</p>}
        <h1 className="mt-0.5 font-display text-[1.85rem] leading-none text-ivory">{event?.name ?? "Your passes"}</h1>
        <p className="mt-1 truncate text-[0.62rem] text-ivory/65">
          {when || "Date to be announced"}
          {" · "}
          {venue?.name ?? event?.city ?? "Venue to be announced"}
        </p>
        {event?.invitation && (
          <p className="mx-auto mt-1 whitespace-nowrap font-display text-[clamp(0.58rem,2.85vw,0.82rem)] italic leading-none text-ivory/70">
            {event.invitation}
          </p>
        )}
        {total > 1 && total <= 10 && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {order.tickets.map((row, i) => {
              const label = passName(row, holder)?.split(" ")[0] ?? `Guest ${row.guest_number}`;
              return (
                <button
                  key={row.guest_number}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`max-w-[7rem] truncate px-2 py-1 text-[0.52rem] font-semibold uppercase tracking-[0.12em] ${
                    i === index ? "text-gold" : "text-ivory/35"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {total > 10 && ticket && (
          <label className="mt-2 inline-flex items-center gap-2 text-[0.52rem] font-semibold uppercase tracking-[0.16em] text-gold">
            <span>Choose pass</span>
            <select
              aria-label="Choose a pass"
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
              className="border border-gold/35 bg-rich px-2 py-1.5 text-[0.6rem] tracking-[0.1em] text-gold outline-none focus:border-gold"
            >
              {order.tickets.map((row, i) => (
                <option key={row.guest_number} value={i}>
                  {passName(row, holder)?.split(" ")[0] ?? `Pass ${row.guest_number}`} · {row.guest_number} of {total}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {order.status === "refunded" && (
        <p role="alert" className="mt-1 shrink-0 text-center text-[0.68rem] text-ivory/80">
          Refunded. These passes are no longer valid.
        </p>
      )}

      <div className="relative mt-1.5 min-h-0 flex-1">
        {ticket && (
          <Pass
            ticket={ticket}
            orderStatus={order.status}
            total={total}
            svg={qr[ticket.token]}
            tierName={order.tier_name}
            holder={named ?? (total > 1 ? `Guest ${ticket.guest_number}` : null)}
            footLeft={
              event?.date
                ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
                    new Date(`${event.date}T12:00:00`),
                  )
                : ""
            }
            footRight={venue?.name ?? event?.city ?? ""}
          />
        )}
        {total > 1 && index > 0 && (
          <button
            type="button"
            aria-label="Previous pass"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="absolute left-0 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center text-2xl text-gold"
          >
            ‹
          </button>
        )}
        {total > 1 && index < total - 1 && (
          <button
            type="button"
            aria-label="Next pass"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            className="absolute right-0 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center text-2xl text-gold"
          >
            ›
          </button>
        )}
      </div>

      {ticket && (
        <TicketActions
          accessToken={order.access_token}
          guestNumber={ticket.guest_number}
          total={total}
          token={ticket.token}
          tierName={order.tier_name}
          event={event}
          when={when}
          venue={venue?.name ?? event?.city ?? ""}
          guestName={properName(ticket.guest_name)}
          senderName={senderName}
          share={ticket.share ?? "none"}
          locked={ticket.status !== "valid" || order.status === "refunded"}
          onChanged={onChanged}
        />
      )}

      {event?.partners && event.partners.length > 0 && (
        <div className="shrink-0 pt-1.5 text-center">
          <p className="text-[0.45rem] font-semibold uppercase tracking-[0.32em] text-gold">Partners</p>
          <div className="mx-auto mt-1 w-[9.375rem]">
            <Image
              src={event.partners[0].logo}
              alt={event.partners[0].name}
              width={event.partners[0].width}
              height={event.partners[0].height}
              loading="eager"
              className="block h-auto w-full bg-white"
            />
            {event.partners.length > 1 && (
              <div className="mt-1 flex gap-1">
                {event.partners.slice(1).map((p) => (
                  <span key={p.name} className="flex h-5 min-w-0 flex-1 items-center justify-center bg-white px-0.5">
                    <Image src={p.logo} alt={p.name} width={p.width} height={p.height} className="max-h-4 w-auto max-w-full object-contain" />
                  </span>
                ))}
              </div>
            )}
          </div>
          {event.partners.some((p) => p.note) && (
            <p className="mx-auto mt-1 max-w-[34ch] text-[0.52rem] leading-tight text-ivory/55">
              {event.partners.find((p) => p.note)?.note}
            </p>
          )}
        </div>
      )}

      <p className="shrink-0 pt-1.5 text-center text-[0.58rem] leading-none tracking-wide text-ivory/40">
        {event?.minimumAge ? `${event.minimumAge}+ · photo ID. ` : ""}
        One pass per guest, scanned once.
      </p>
    </div>
  );
}

interface PassProps {
  ticket: TicketRow;
  orderStatus: OrderView["status"];
  total: number;
  svg: string;
  tierName: string;
  holder: string | null;
  footLeft: string;
  footRight: string;
}

/** One guest's pass: black stock, gold hairline, ivory QR panel, perforated stub. */
function Pass({ ticket, orderStatus, total, svg, tierName, holder, footLeft, footRight }: PassProps) {
  const standing = passStanding(ticket.status, orderStatus);
  const blocked = standing !== "VALID";
  return (
    <article className="relative flex h-full flex-col overflow-hidden bg-[#12110F]">
      <div aria-hidden className="pointer-events-none absolute inset-0 border border-gold/55" />
      <div aria-hidden className="pointer-events-none absolute inset-[5px] border border-gold/20" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(90% 40% at 50% 0%, rgba(187,155,99,0.10), transparent 70%)" }}
      />

      <div className="relative shrink-0 px-4 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[0.52rem] font-semibold uppercase tracking-[0.34em] text-gold">Admit one</span>
          <span className="text-[0.52rem] font-semibold uppercase tracking-[0.2em] text-ivory/40">
            {pad2(ticket.guest_number)} / {pad2(total)}
          </span>
        </div>
        <p className="mt-1.5 text-center text-[0.52rem] font-semibold uppercase tracking-[0.28em] text-gold">{tierName}</p>
        {holder && <p className="mt-1 text-center font-display text-[1.35rem] italic leading-none text-ivory">{holder}</p>}
      </div>

      <div className="@container/qr relative flex min-h-0 flex-1 items-center justify-center px-4 py-1.5">
        <div className="relative aspect-square w-[min(100%,9.375rem,100cqh)] bg-[#F4F1EA] p-2.5 shadow-[0_0_0_1px_rgba(187,155,99,0.45)]">
          <div
            role="img"
            aria-label={`QR code for pass ${ticket.guest_number}`}
            className={cn("size-full [&>svg]:size-full", blocked && "opacity-[0.12]")}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {blocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="-rotate-12 border-2 border-rich/80 px-3 py-2 text-center text-[0.62rem] font-bold uppercase tracking-[0.22em] text-rich">
                {standing}
                {standing === "ALREADY USED" && ticket.checked_in_at && (
                  <span className="mt-1 block tracking-[0.16em]">{time(ticket.checked_in_at)}</span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
      <p className="relative shrink-0 pb-1 text-center font-mono text-[0.58rem] tracking-[0.38em] text-gold/70">
        Nº {ticket.token.slice(-6).toUpperCase()}
      </p>

      {/* perforation with punched notches */}
      <div aria-hidden className="relative flex items-center">
        <span className="absolute -left-2.5 size-5 rounded-full border border-gold/40 bg-[#0A0A09]" />
        <span className="mx-6 h-px flex-1 border-t border-dashed border-gold/35" />
        <span className="absolute -right-2.5 size-5 rounded-full border border-gold/40 bg-[#0A0A09]" />
      </div>

      <div className="relative flex shrink-0 items-center justify-between gap-3 py-2 pl-8 pr-5">
        <span className="min-w-0 truncate text-[0.5rem] font-semibold uppercase tracking-[0.14em] text-ivory/45">{footLeft}</span>
        <span className="min-w-0 truncate text-right text-[0.5rem] font-semibold uppercase tracking-[0.14em] text-ivory/45">{footRight}</span>
      </div>
    </article>
  );
}
