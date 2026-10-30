"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { housePartyArrival } from "@/lib/house-party-arrival";

export function HousePartyPassCard({
  fullName,
  partySize,
  guestNames,
  code,
  token,
}: {
  fullName: string;
  partySize: number;
  guestNames: string[];
  code: string;
  token?: string | null;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const guests = guestNames.filter(Boolean);

  useEffect(() => {
    if (!token) return;
    const url = `${window.location.origin}/house-party/pass?t=${token}`;
    void QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: "#0F0F10", light: "#F6F1E8" } }).then(setQr).catch(() => {});
  }, [token]);

  return (
    <article className="mx-auto w-full max-w-md overflow-hidden border border-[#c6a15b] bg-[#141011] text-left text-[#f6f1e8] shadow-[0_24px_70px_-36px_rgba(198,161,91,0.8)]">
      <div className="border-b border-[#c6a15b]/40 px-5 py-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.sealPath} alt={brand.logo.alt} width={64} height={64} className="mx-auto size-16" />
        <p className="eyebrow mt-4 text-[#df8a42]">One More House Party Pass</p>
        <h2 className="mt-2 font-headline text-4xl">Diwali × Halloween<br />House Party</h2>
        <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#c6a15b]">Free RSVP · Confirmed</p>
      </div>
      <div className="space-y-3 px-5 py-5 text-sm">
        <PassRow label="RSVP name" value={fullName} />
        <PassRow label="Party size" value={`${partySize} ${partySize === 1 ? "person" : "people"}`} />
        {guests.length > 0 && <PassRow label="Guests" value={guests.join(", ")} />}
        <PassRow label="Date" value="Oct 30, 2026" />
        <PassRow label="Time" value="9 PM onwards" />
        <PassRow label="Age" value="21+ only" />
        <PassRow label="Arrival" value={`${housePartyArrival.name} · ${housePartyArrival.place}`} />
        <p className="pt-1 text-xs leading-5 text-[#f6f1e8]/70">Arrive at the shared location. Once you arrive, contact us and we&apos;ll guide you to the house.</p>
        <p className="text-xs leading-5 text-[#f6f1e8]/70">BYOB. No alcohol is available for purchase from the host. Bring a valid 21+ photo ID.</p>
        {code && <PassRow label="Pass code" value={code} />}
      </div>
      {qr && (
        <div className="px-5 pb-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="" width={148} height={148} className="mx-auto bg-[#f6f1e8] p-2" />
        </div>
      )}
      <p className="bg-[#c6a15b] py-3 text-center text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#0f0f10]">Free entry</p>
    </article>
  );
}

function PassRow({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[#c6a15b]">{label}</span>
      <span className="mt-0.5 block">{value}</span>
    </p>
  );
}
