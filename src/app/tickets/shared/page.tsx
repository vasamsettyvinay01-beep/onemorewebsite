"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { events } from "@/data/events";
import { functionUrl } from "@/data/backend";
import { refundPolicy } from "@/data/refund-policy";
import { formatEventTime } from "@/lib/events";
import { passStanding } from "@/lib/pass-standing";

interface SharedPass {
  guestNumber: number;
  admissionCode: string;
  status: "valid" | "checked-in" | "cancelled";
  checkedInAt: string | null;
  eventId: string;
  tierName: string;
  orderStatus: string;
  reference: string;
}

export default function SharedTicketPage() {
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [pass, setPass] = useState<SharedPass | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "");
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!/^[0-9a-f]{64}$/.test(token)) {
      const frame = requestAnimationFrame(() => setState("missing"));
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    fetch(functionUrl("ticket-share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action: "read", token }),
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
        setPass(body);
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
          <h1 className="mt-2 font-display text-4xl">{event?.name ?? "Pass"}</h1>
          <p className="mt-2 text-sm text-ivory/70">
            {event?.date ?? "Date to be announced"}
            {event ? ` · ${formatEventTime(event)}` : ""} · {event?.venue?.name ?? "Venue to be announced"}
          </p>
          <p className="mt-1 text-sm text-ivory/60">
            {pass.tierName} · Guest {pass.guestNumber} · Nº {pass.reference}
          </p>
          <div
            className={`mx-auto mt-6 size-56 bg-[#F4F1EA] p-3 ${blocked ? "opacity-40" : ""}`}
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="mt-4 text-sm leading-relaxed text-ivory/70">{refundPolicy.shareWarning}</p>
          {label === "INVALID" && (
            <p className="mt-2 text-sm text-ivory/80">
              {pass.orderStatus === "refunded"
                ? "Refunded. This pass is no longer valid."
                : "This pass is no longer valid."}
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
