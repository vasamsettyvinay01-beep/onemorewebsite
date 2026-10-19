"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { refundPolicy } from "@/data/refund-policy";
import { functionUrl } from "@/data/backend";
import type { OneMoreEvent } from "@/types/event";
import { Dialog } from "@/components/ui/Dialog";

interface TicketActionsProps {
  accessToken: string;
  guestNumber: number;
  total: number;
  token: string;
  tierName: string;
  event: OneMoreEvent | undefined;
  when: string;
  venue: string;
  /** Name the friend put on this pass. The buyer still holds the pass either way. */
  guestName: string | null;
  senderName: string;
  share: "none" | "ready" | "opened";
  locked: boolean;
  onChanged: () => void;
}

const button =
  "border border-gold/50 px-3 py-2 text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-gold disabled:opacity-50";

export function TicketActions({
  accessToken,
  guestNumber,
  total,
  token,
  tierName,
  event,
  when,
  venue,
  guestName,
  senderName,
  share,
  locked,
  onChanged,
}: TicketActionsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<{ url: string } | null>(null);
  const reference = token.slice(-6).toUpperCase();
  const eventName = event?.name ?? "One More";

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
      ctx.fillText(eventName, 64, 180);
      ctx.font = "24px sans-serif";
      ctx.fillStyle = "rgba(236,234,228,0.75)";
      ctx.fillText(when || "Date to be announced", 64, 230);
      ctx.fillText(venue || "Venue to be announced", 64, 268);
      const who = guestName ?? (guestNumber === 1 ? senderName : `Guest ${guestNumber}`);
      ctx.fillText(`${tierName} · ${who} · ${guestNumber} of ${total}`, 64, 320);
      const image = new Image();
      image.src = qr;
      await image.decode();
      ctx.fillStyle = "#F4F1EA";
      ctx.fillRect(210, 400, 480, 480);
      ctx.drawImage(image, 230, 420, 440, 440);
      ctx.fillStyle = "#BB9B63";
      ctx.font = "28px monospace";
      ctx.fillText(`Nº ${reference}`, 64, 980);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("no_image");
      const filename = `one-more-pass-${reference}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${eventName} pass` });
          setMessage("Choose Save Image or Save to Files to keep this pass.");
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Pass saved.");
    } catch {
      setMessage("Could not save this pass. Take a screenshot of the QR instead.");
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
    if (!res.ok) {
      setMessage(typeof body?.error === "string" ? body.error : "Could not prepare this pass.");
      return null;
    }
    return typeof body?.url === "string" ? body.url : null;
  }

  async function sendPass() {
    setBusy(true);
    setMessage(null);
    try {
      const url = await createLink();
      if (!url) return;
      setInvite({ url });
      onChanged();
      if (navigator.share) {
        try {
          await navigator.share(invitePayload(url));
          setMessage("Pass sent. You still have it here.");
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        }
      }
      setOpen(true);
    } catch {
      setMessage("Could not prepare this pass.");
    } finally {
      setBusy(false);
    }
  }

  function invitePayload(url: string) {
    return {
      title: eventName,
      text: `${senderName} sent you a pass to ${eventName}. Open it and put your name on it.`,
      url,
    };
  }

  async function copyInvite(url: string) {
    const payload = invitePayload(url);
    try {
      await navigator.clipboard.writeText(`${payload.text} ${url}`);
      setMessage("Invitation copied. You still have this pass here.");
    } catch {
      setMessage("Could not copy the invitation.");
    }
  }

  async function sendEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(functionUrl("ticket-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "email",
          accessToken,
          guestNumber,
          email,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(typeof body?.error === "string" ? body.error : "Could not send the pass.");
        return;
      }
      setMessage(`Pass sent to ${email.trim()}. You still have it here.`);
      setEmail("");
      setInvite(null);
      onChanged();
    } catch {
      setMessage("Could not send the pass.");
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
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(typeof body?.error === "string" ? body.error : "Could not revoke the invitation.");
        return;
      }
      setInvite(null);
      setMessage("Invitation revoked. This pass is still yours. A copy already saved can still be scanned once.");
      onChanged();
    } catch {
      setMessage("Could not revoke the invitation. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const note =
    guestName && share === "opened"
      ? `${guestName} has opened this pass`
      : guestName
        ? `In the name of ${guestName}`
        : share === "opened"
          ? "Opened. Name not added yet."
          : share === "ready"
            ? "Invitation ready"
            : null;

  const whatsApp = invite
    ? `https://wa.me/?text=${encodeURIComponent(`${invitePayload(invite.url).text} ${invite.url}`)}`
    : null;

  return (
    <div className="shrink-0 pt-2 text-center">
      {note && <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-gold">{note}</p>}
      <p className="mx-auto mt-1 max-w-[38ch] text-[0.58rem] leading-snug text-ivory/45">{refundPolicy.shareWarning}</p>
      <div className="mt-2 flex justify-center gap-2">
        <button type="button" disabled={busy} onClick={save} className={button}>
          Save ticket
        </button>
        {!locked && (
          <button type="button" disabled={busy} onClick={() => void sendPass()} className={button}>
            {share === "none" && !guestName ? "Send this pass" : "Send again"}
          </button>
        )}
      </div>
      {!locked && share !== "none" && (
        <button type="button" disabled={busy} onClick={revoke} className="mt-1 text-[0.55rem] uppercase tracking-[0.14em] text-ivory/40">
          Revoke invitation
        </button>
      )}
      {message && <p className="mt-1 text-[0.62rem] text-ivory/70">{message}</p>}
      <p className="mt-1 text-[0.58rem] text-ivory/40">
        <a href="/refunds/" className="underline-offset-2 hover:underline">
          Refund Policy
        </a>
      </p>

      <Dialog
        open={open && !locked}
        onClose={() => setOpen(false)}
        title={`Send pass ${guestNumber} of ${total}`}
        hideTitle
        className="max-w-[26.5rem]"
      >
          <div className="px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-left">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-gold">
                Pass {guestNumber} of {total}
              </p>
              <button
                type="button"
                data-autofocus
                onClick={() => setOpen(false)}
                className="text-[0.62rem] uppercase tracking-[0.16em] text-ivory/50"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-[0.72rem] leading-snug text-ivory/70">
              You keep this pass. A new invitation replaces the last link and clears the name. A QR already saved can still be scanned once.
            </p>
            {invite && (
              <div className="mt-3 flex flex-wrap gap-2">
                {navigator.share && (
                  <button type="button" onClick={() => void navigator.share(invitePayload(invite.url)).catch(() => undefined)} className={button}>
                    Share
                  </button>
                )}
                {whatsApp && (
                  <a href={whatsApp} target="_blank" rel="noreferrer" className={button}>
                    WhatsApp
                  </a>
                )}
                <button type="button" onClick={() => void copyInvite(invite.url)} className={button}>
                  Copy link
                </button>
              </div>
            )}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendEmail();
              }}
            >
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Their email"
                className="min-w-0 flex-1 border border-ivory/15 bg-transparent px-3 py-2 text-sm text-ivory outline-none placeholder:text-ivory/30 focus:border-gold/60"
              />
              <button type="submit" disabled={busy || !email.trim()} className={button}>
                Email
              </button>
            </form>
          </div>
      </Dialog>
    </div>
  );
}
