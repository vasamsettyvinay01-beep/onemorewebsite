"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { doorCall, DoorAuthError, signOutDoor, type VipAdmitResult, type VipGroup } from "./door-api";

const ADMITTED_DISMISS_MS = 2600;

/** 1..remaining, capped at six. Never offers more than the group has left. */
export function admitChoices(remaining: number): number[] {
  const max = Math.min(Math.max(Math.floor(remaining), 0), 6);
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * VIP group admission. Black surface and a gold VIP label so staff recognise it
 * at a glance; the remaining count is the largest thing on screen. The server
 * admits atomically, so a race with another phone comes back as a refreshed count.
 */
export function VipDoorPanel({
  eventId,
  group: initial,
  device,
  onClose,
  onAdmitted,
  feedback,
}: {
  eventId: string;
  group: VipGroup;
  device?: string;
  onClose: () => void;
  onAdmitted: () => void;
  feedback: (ok: boolean) => void;
}) {
  const [group, setGroup] = useState(initial);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [admitted, setAdmitted] = useState<{ count: number; group: VipGroup } | null>(null);

  useEffect(() => {
    if (!admitted) return;
    const timer = setTimeout(onClose, ADMITTED_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [admitted, onClose]);

  const blocked = group.status === "revoked" || group.status === "cancelled";
  const complete = !blocked && group.remaining <= 0;
  const choices = admitChoices(group.remaining);

  async function admit() {
    if (!count || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await doorCall<VipAdmitResult>({ action: "vip_admit", eventId, code: group.code, count, device });
      if (result.outcome === "vip-admitted" && result.vip) {
        feedback(true);
        setAdmitted({ count: result.admittedNow ?? count, group: result.vip });
        setGroup(result.vip);
        setCount(null);
        onAdmitted();
        return;
      }
      feedback(false);
      if (result.vip) setGroup(result.vip);
      setCount(null);
      setNote(
        result.reason === "exceeds-remaining" && result.vip
          ? `Only ${result.vip.remaining} remaining. Another device just admitted guests.`
          : result.reason === "complete"
            ? "Every admission on this pass has been used."
            : result.reason === "revoked" || result.reason === "cancelled"
              ? "This pass is no longer active."
              : "Not admitted. Scan again.",
      );
      onAdmitted();
    } catch (err) {
      if (err instanceof DoorAuthError) {
        await signOutDoor();
        return;
      }
      feedback(false);
      setNote("Couldn’t reach the server. Check signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (admitted) {
    return (
      <button type="button" onClick={onClose} className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-emerald-600 px-6 text-center text-white">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">VIP access · {admitted.group.table}</span>
        <span className="mt-4 font-display text-7xl leading-none">Admitted {admitted.count}</span>
        <span className="mt-6 text-lg font-semibold">
          {admitted.group.remaining > 0 ? `${admitted.group.remaining} remaining on this pass` : "VIP access complete"}
        </span>
        <span className="mt-1 text-base opacity-90">Host · {admitted.group.host}</span>
        <span className="mt-10 text-xs font-semibold uppercase tracking-[0.24em] opacity-80">Tap to scan next</span>
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-[#0F0F10] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 text-[#F6F1E8]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 border border-[#C6A15B] px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-[0.32em] text-[#C6A15B]">
            VIP Access
          </span>
          <p className="mt-3 truncate font-display text-4xl leading-none">{group.table}</p>
          <p className="mt-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[#F6F1E8]/45">Host</p>
          <p className="truncate text-lg font-semibold">{group.host}</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md border border-[#F6F1E8]/20 px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#F6F1E8]/70">
          Close
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-3 border-y border-[#F6F1E8]/10 py-4 text-center">
        <div>
          <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#F6F1E8]/45">Authorized</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">{group.capacity}</dd>
        </div>
        <div>
          <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#F6F1E8]/45">Admitted</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">{group.admitted}</dd>
        </div>
        <div>
          <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#C6A15B]">Remaining</dt>
          <dd className={cn("mt-1 text-5xl font-bold tabular-nums leading-none", blocked ? "text-red-400" : "text-[#C6A15B]")}>{blocked ? 0 : group.remaining}</dd>
        </div>
      </dl>

      {blocked && (
        <div className="mt-5 bg-red-600 px-4 py-5 text-center text-white">
          <p className="font-display text-4xl leading-none">Pass revoked</p>
          <p className="mt-2 text-sm font-semibold">Do not admit on this code.</p>
        </div>
      )}
      {complete && (
        <div className="mt-5 bg-amber-500 px-4 py-5 text-center text-black">
          <p className="font-display text-4xl leading-none">VIP access complete</p>
          <p className="mt-2 text-sm font-semibold">All {group.capacity} admissions have been used. No more entries.</p>
        </div>
      )}

      {!blocked && !complete && (
        <>
          <p className="mt-5 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#F6F1E8]/55">How many guests are entering?</p>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {choices.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={count === option}
                onClick={() => setCount(option)}
                className={cn(
                  "h-16 rounded-md border text-2xl font-semibold tabular-nums",
                  count === option ? "border-[#C6A15B] bg-[#C6A15B] text-[#0F0F10]" : "border-[#F6F1E8]/20 text-[#F6F1E8]",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void admit()}
            disabled={!count || busy}
            className="mt-auto h-16 w-full shrink-0 rounded-md bg-emerald-600 text-base font-bold uppercase tracking-[0.16em] text-white disabled:bg-[#F6F1E8]/10 disabled:text-[#F6F1E8]/35"
          >
            {busy ? "Admitting…" : count ? `Admit ${count} VIP ${count === 1 ? "guest" : "guests"}` : "Select guests entering"}
          </button>
        </>
      )}
      {note && <p role="alert" className="mt-4 text-center text-sm font-semibold text-amber-300">{note}</p>}
      {(blocked || complete) && (
        <button type="button" onClick={onClose} className="mt-auto h-14 w-full rounded-md border border-[#F6F1E8]/20 text-xs font-semibold uppercase tracking-[0.22em]">
          Scan next
        </button>
      )}
    </div>
  );
}
