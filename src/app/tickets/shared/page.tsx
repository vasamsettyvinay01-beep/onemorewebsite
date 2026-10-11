"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { events } from "@/data/events";
import { functionUrl } from "@/data/backend";
import { refundPolicy } from "@/data/refund-policy";
import { formatEventTime } from "@/lib/events";
import { passStanding } from "@/lib/pass-standing";

interface SharedPass {
  shareToken: string;
  guestNumber: number;
  guestName: string | null;
  senderName: string | null;
  admissionCode: string;
  status: "valid" | "checked-in" | "cancelled";
  checkedInAt: string | null;
  eventId: string;
  tierName: string;
  orderStatus: string;
  total: number;
  reference: string;
}

export default function SharedTicketPage() {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [pass, setPass] = useState<SharedPass | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    const hash = tokenRef.current ?? window.location.hash.replace(/^#/, "");
    if (!tokenRef.current && window.location.hash) {
      tokenRef.current = hash;
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      const frame = requestAnimationFrame(() => setState("missing"));
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    fetch(functionUrl("ticket-share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action: "read", token: hash }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState("missing");
          return;
        }
        const body: SharedPass = await res.json();
        const svg = await QRCode.toString(body.admissionCode, {
          type: "svg",
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#0F100F", light: "#F4F1EA" },
        });
        if (cancelled || !svg.trimStart().startsWith("<svg")) {
          setState("missing");
          return;
        }
        setPass({ ...body, shareToken: hash });
        setQr(svg);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const event = events.find((item) => item.id === pass?.eventId);
  const label = pass ? passStanding(pass.status, pass.orderStatus) : "INVALID";
  const blocked = label !== "VALID";
  const when = event ? [event.date, formatEventTime(event)].filter(Boolean).join(" · ") : "";

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-md flex-col bg-[#0A0A09] px-5 py-8 text-ivory">
      <Link href="/" className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-gold">
        {brand.name}
      </Link>
      {state === "loading" && <p className="mt-16 text-ivory/60">One moment…</p>}
      {state === "missing" && <p className="mt-16 text-ivory/70">This shared link is not valid.</p>}
      {state === "ready" && pass && (
        <>
          <p className="mt-8 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-gold">{label}</p>
          {pass.senderName && (
            <p className="mt-3 font-display text-2xl italic text-gold-soft">{pass.senderName} sent you a pass</p>
          )}
          <h1 className="mt-2 font-display text-4xl">{event?.name ?? "Pass"}</h1>
          <p className="mt-2 text-sm text-ivory/70">
            {when || "Date to be announced"} · {event?.venue?.name ?? "Venue to be announced"}
          </p>
          <p className="mt-1 text-sm text-ivory/60">
            {pass.tierName} · {pass.guestNumber} of {pass.total || 1} · Nº {pass.reference}
          </p>
          {pass.guestName && <p className="mt-4 font-display text-3xl italic">{pass.guestName}</p>}
          <div
            className={`mx-auto mt-6 size-56 bg-[#F4F1EA] p-3 ${blocked ? "opacity-40" : ""}`}
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          {!blocked && (
            <ClaimName
              token={pass.shareToken}
              current={pass.guestName}
              onNamed={(guestName) => setPass({ ...pass, guestName })}
            />
          )}
          <p className="mt-4 text-sm leading-relaxed text-ivory/70">{refundPolicy.shareWarning}</p>
          {label === "INVALID" && (
            <p className="mt-2 text-sm text-ivory/80">
              {pass.orderStatus === "refunded" ? "Refunded. This pass is no longer valid." : "This pass is no longer valid."}
            </p>
          )}
          {label === "ALREADY USED" && pass.checkedInAt && (
            <p className="mt-2 text-sm text-amber-200">Checked in {new Date(pass.checkedInAt).toLocaleString()}.</p>
          )}
        </>
      )}
    </main>
  );
}

function ClaimName({ token, current, onNamed }: { token: string; current: string | null; onNamed: (name: string) => void }) {
  const [name, setName] = useState(current ?? "");
  const [editing, setEditing] = useState(!current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(functionUrl("ticket-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", token, name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.guestName !== "string") {
        setError(typeof body?.error === "string" ? body.error : "Could not save your name.");
        return;
      }
      onNamed(body.guestName);
      setName(body.guestName);
      setEditing(false);
    } catch {
      setError("Could not save your name.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="mt-4 text-[0.62rem] uppercase tracking-[0.16em] text-ivory/45">
        Correct my name
      </button>
    );
  }

  return (
    <form
      className="mt-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold" htmlFor="guest-name">
        {current ? "Correct your name" : "Put your name on this pass"}
      </label>
      <input
        id="guest-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        placeholder="As on your photo ID"
        className="mt-2 w-full border border-ivory/15 bg-transparent px-3 py-3 text-base text-ivory outline-none placeholder:text-ivory/30 focus:border-gold/60"
      />
      <button
        type="submit"
        disabled={busy || name.trim().length < 2}
        className="mt-3 border border-gold/70 px-5 py-3 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold disabled:opacity-50"
      >
        {current ? "Save name" : "Make this pass mine"}
      </button>
      {error && <p className="mt-2 text-sm text-ivory/80">{error}</p>}
    </form>
  );
}
