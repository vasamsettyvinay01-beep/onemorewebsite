"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHousePartyStatus, spotsLabel, type HousePartyStatus } from "@/lib/house-party";

/**
 * Kept client-only so the static export contains no expired promotion. The
 * Edge Function uses the database clock as the authoritative expiry source.
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

  return (
    <aside className="fixed inset-x-3 top-[5.6rem] z-[60] mx-auto max-w-xl sm:top-24">
      <div className="relative overflow-hidden rounded-[3px] border border-[#c6a15b]/75 bg-[#14100f]/96 px-3.5 py-2.5 shadow-[0_18px_55px_-20px_rgba(0,0,0,0.95),0_0_45px_-18px_rgba(198,109,38,0.85)] backdrop-blur-xl sm:px-5 sm:py-3">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 size-32 rounded-full bg-[#9d3b20]/25 blur-3xl sm:-right-12 sm:-top-20 sm:size-44 sm:bg-[#9d3b20]/30" />
        <div className="relative flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-headline text-[0.92rem] leading-tight text-ivory sm:text-[1.2rem]">Diwali × Halloween House Party</p>
            <p className="mt-1 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-ivory/65 sm:mt-1.5 sm:text-[0.62rem] sm:tracking-[0.15em]">
              Tonight · Free · 21+ ·{" "}
              <span className="text-[#c6a15b]">{status.state === "full" ? "House full" : spotsLabel(status.spotsRemaining)}</span>
            </p>
          </div>
          <Link
            href="/house-party"
            className="shrink-0 rounded-[2px] bg-[#c6a15b] px-2.5 py-2.5 text-center text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[#0f0f10] transition-colors hover:bg-[#f6f1e8] sm:px-3 sm:py-3 sm:text-[0.62rem] sm:tracking-[0.15em]"
          >
            {status.state === "full" ? "House full" : "RSVP free"}
          </Link>
        </div>
      </div>
    </aside>
  );
}
