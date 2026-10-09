"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { refundPolicy } from "@/data/refund-policy";
import { functionUrl } from "@/data/backend";
import type { OneMoreEvent } from "@/types/event";

interface TicketActionsProps {
  accessToken: string;
  guestNumber: number;
  total: number;
  token: string;
  tierName: string;
  event: OneMoreEvent | undefined;
  when: string;
  venue: string;
}

export function TicketActions({ accessToken, guestNumber, total, token, tierName, event, when, venue }: TicketActionsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reference = token.slice(-6).toUpperCase();

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const qr = await QRCode.toDataURL(token, { margin: 1, width: 480, color: { dark: "#0F100F", light: "#F4F1EA" } });
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#12110F";
      ctx.fillRect(0, 0, 900, 1200);
      ctx.strokeStyle = "#BB9B63";
      ctx.strokeRect(24, 24, 852, 1152);
      ctx.fillStyle = "#BB9B63";
      ctx.font = "600 22px sans-serif";
      ctx.fillText("THE ONE MORE COMPANY", 64, 100);
      ctx.fillStyle = "#ECEAE4";
      ctx.font = "600 54px serif";
      ctx.fillText(event?.name ?? "Your pass", 64, 180);
      ctx.font = "24px sans-serif";
      ctx.fillStyle = "rgba(236,234,228,0.75)";
      ctx.fillText(when || "Date to be announced", 64, 230);
      ctx.fillText(venue || "Venue to be announced", 64, 268);
      ctx.fillText(`${tierName} · ${guestNumber} of ${total}`, 64, 320);
      const image = new Image();
      image.src = qr;
      await image.decode();
      ctx.fillStyle = "#F4F1EA";
      ctx.fillRect(210, 400, 480, 480);
      ctx.drawImage(image, 230, 420, 440, 440);
      ctx.fillStyle = "#BB9B63";
      ctx.font = "28px monospace";
      ctx.fillText(`Nº ${reference}`, 64, 980);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `one-more-pass-${reference}.png`;
      link.click();
    } finally {
      setBusy(false);
    }
  }

  async function createLink(): Promise<string | null> {
    const res = await fetch(functionUrl("ticket-share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", accessToken, guestNumber }),
    });
    const body = await res.json().catch(() => null);
    return res.ok && typeof body?.url === "string" ? body.url : null;
  }

  async function share() {
    setBusy(true);
    setMessage(null);
    try {
      const url = await createLink();
      if (!url) {
        setMessage("Could not create a share link.");
        return;
      }
      const payload = { title: event?.name ?? "One More pass", text: refundPolicy.shareWarning, url };
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("Share link copied. Each ticket can be checked in only once.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessage("Could not share this ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    setBusy(true);
    setMessage(null);
    try {
      const url = await createLink();
      if (!url) {
        setMessage("Could not create a share link.");
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("Share link copied. A new link replaces any previous one for this ticket.");
    } catch {
      setMessage("Could not copy the share link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(functionUrl("ticket-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", accessToken, guestNumber }),
      });
      setMessage(res.ok ? "Shared link revoked. This pass is still valid." : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 pt-2 text-center">
      <p className="mx-auto max-w-[36ch] text-[0.58rem] leading-snug text-ivory/45">{refundPolicy.shareWarning}</p>
      <div className="mt-2 flex justify-center gap-2">
        <button type="button" disabled={busy} onClick={save} className="border border-gold/50 px-3 py-2 text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-gold disabled:opacity-50">
          Save ticket
        </button>
        <button type="button" disabled={busy} onClick={share} className="border border-gold/50 px-3 py-2 text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-gold disabled:opacity-50">
          Share ticket
        </button>
        <button type="button" disabled={busy} onClick={copyLink} className="border border-gold/50 px-3 py-2 text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-gold disabled:opacity-50">
          Copy link
        </button>
        <button type="button" disabled={busy} onClick={revoke} className="px-2 py-2 text-[0.55rem] uppercase tracking-[0.14em] text-ivory/40">
          Revoke link
        </button>
      </div>
      {message && <p className="mt-1 text-[0.62rem] text-ivory/70">{message}</p>}
      <p className="mt-1 text-[0.58rem] text-ivory/40">
        <a href="/refunds/" className="underline-offset-2 hover:underline">Refund Policy</a>
      </p>
    </div>
  );
}
