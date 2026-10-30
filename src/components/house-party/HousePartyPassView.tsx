"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { HousePartyPassCard } from "./HousePartyPassCard";
import { getHousePartyPass, type HousePartyPass } from "@/lib/house-party";
import { housePartyArrival } from "@/lib/house-party-arrival";

export function HousePartyPassView() {
  const token = useSearchParams().get("t") ?? "";
  const valid = /^[0-9a-f]{48}$/.test(token);
  const [pass, setPass] = useState<HousePartyPass | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let cancel = false;
    void getHousePartyPass(token)
      .then((next) => {
        if (!cancel) setPass(next);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [token, valid]);

  return (
    <main className="min-h-dvh bg-[#0f0f10] px-4 py-10 text-[#f6f1e8]">
      {pass ? (
        <div className="mx-auto max-w-md">
          <HousePartyPassCard {...pass} token={token} />
          <a href={housePartyArrival.href} target="_blank" rel="noopener noreferrer" className="mt-6 flex h-12 items-center justify-center bg-[#c6a15b] text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[#0f0f10]">
            Open arrival location
          </a>
          <Link href="/checkout?event=diwali-night" className="mt-3 flex h-12 items-center justify-center border border-[#c6a15b] text-[0.68rem] font-semibold uppercase tracking-[0.15em]">
            Get Nov 7 Tickets
          </Link>
        </div>
      ) : (
        <p className="pt-16 text-center font-display text-3xl">{!valid || failed ? "This pass is not available." : "Opening your pass…"}</p>
      )}
    </main>
  );
}
