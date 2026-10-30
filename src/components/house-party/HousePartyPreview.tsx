"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHousePartyStatus, spotsLabel, type HousePartyStatus } from "@/lib/house-party";

/**
 * A quiet, secondary card beneath the main hero. Tonight's free house party —
 * clearly real, clearly free, clearly smaller than the main event. Hidden
 * once the Edge Function's database clock says the night is over.
 */
export function HousePartyPreview() {
  const [status, setStatus] = useState<HousePartyStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getHousePartyStatus(controller.signal)
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);

  if (loaded && (!status || status.state === "ended")) return null;

  const full = status?.state === "full";

  return (
    <div className="page-container pb-[8svh] sm:pb-[10svh]">
      <div className="mx-auto max-w-xl">
        <div className="rounded-[3px] border border-gold/25 bg-ivory/[0.03] px-5 py-5 sm:px-6 sm:py-6">
          {status ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="eyebrow text-[0.58rem] text-[#df8a42]">Tonight · Free entry</p>
                <p className="mt-1.5 font-headline text-[1.1rem] text-ivory">Diwali × Halloween House Party</p>
                <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-ivory/55">
                  Free RSVP · Only 30 spots · 21+
                </p>
                <p className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-gold">
                  {full ? "House full" : spotsLabel(status.spotsRemaining)}
                </p>
              </div>
              <Link
                href="/house-party"
                className="shrink-0 rounded-[2px] border border-gold/60 px-5 py-3 text-center text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-ivory transition-colors hover:border-gold hover:bg-gold hover:text-rich sm:px-6"
              >
                {full ? "House full" : "Claim Free RSVP"}
              </Link>
            </div>
          ) : (
            <div aria-hidden className="h-[4.75rem] animate-pulse sm:h-[3.5rem]" />
          )}
        </div>
      </div>
    </div>
  );
}
