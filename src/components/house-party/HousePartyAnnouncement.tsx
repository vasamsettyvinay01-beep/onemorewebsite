"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHousePartyStatus, spotsLabel, type HousePartyStatus } from "@/lib/house-party";

/**
 * Kept client-only so the static export contains no expired promotion. The
 * Edge Function uses the database clock as the authoritative expiry source.
 *
 * Rendered inside the fixed header, above the nav row — a thin, single-line
 * live strip. It must never compete with the main hero below it.
 */
export function HousePartyAnnouncement() {
  const [status, setStatus] = useState<HousePartyStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getHousePartyStatus(controller.signal)
      .then(setStatus)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!status || status.state === "ended") return null;

  const full = status.state === "full";

  return (
    <div className="border-b border-gold/20 bg-[#0b0c0b]/94">
      <Link
        href="/house-party"
        className="group flex items-center justify-center gap-2 px-4 py-2 text-center sm:gap-3 sm:py-2.5"
      >
        <span aria-hidden className="relative hidden size-1.5 shrink-0 sm:flex">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold-soft opacity-70" />
          <span className="relative size-1.5 rounded-full bg-gold-soft" />
        </span>
        <span className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-ivory/80 sm:text-[0.64rem] sm:tracking-[0.14em]">
          Tonight · Free House Party · {full ? "House full" : spotsLabel(status.spotsRemaining)}
        </span>
        <span className="shrink-0 rounded-[2px] bg-gold px-2.5 py-1 text-[0.54rem] font-semibold uppercase tracking-[0.12em] text-rich transition-colors group-hover:bg-gold-soft sm:px-3 sm:text-[0.58rem]">
          {full ? "Details" : "RSVP free"}
        </span>
      </Link>
    </div>
  );
}
