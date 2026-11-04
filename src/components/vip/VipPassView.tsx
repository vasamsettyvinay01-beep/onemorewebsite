"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { brand } from "@/data/brand";
import { cn } from "@/lib/cn";
import { fetchVipPass, VIP_TOKEN_RE, type VipPassResult } from "@/lib/vip";
import { VipCredential } from "./VipCredential";
import styles from "./vip.module.css";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The credential travels in the fragment, so it never reaches a server log or a referrer. */
function readToken() {
  return window.location.hash.replace(/^#/, "").trim().toLowerCase();
}

export function VipPassView() {
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const valid = token != null && VIP_TOKEN_RE.test(token);
  const [loaded, setLoaded] = useState<{ token: string; pass: VipPassResult | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!valid || !token) return;
    let cancel = false;
    fetchVipPass(token)
      .then((pass) => {
        if (!cancel) setLoaded({ token, pass, failed: false });
      })
      .catch(() => {
        if (!cancel) setLoaded({ token, pass: null, failed: true });
      });
    return () => {
      cancel = true;
    };
  }, [token, valid]);

  const current = loaded?.token === token ? loaded : null;
  let body: React.ReactNode;
  if (token === null || (valid && !current)) {
    body = <Notice title="Opening your invitation" quiet />;
  } else if (!valid || (current && !current.failed && !current.pass)) {
    body = <Notice title="This invitation is not available." detail="Open the link from your invitation email." />;
  } else if (current?.failed) {
    body = <Notice title="We couldn’t open your invitation." detail="Check your connection and try again." />;
  } else if (current?.pass?.status === "inactive") {
    body = <Notice title="This invitation is no longer active." detail={`For assistance, contact ${brand.email}.`} />;
  } else if (current?.pass && token) {
    body = <VipCredential pass={current.pass} qrValue={token} />;
  }

  return (
    <main className={cn("relative min-h-dvh overflow-hidden", styles.surface)}>
      <div aria-hidden className={styles.grain} />
      <div className="relative px-5 pb-[max(4rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">{body}</div>
    </main>
  );
}

function Notice({ title, detail, quiet = false }: { title: string; detail?: string; quiet?: boolean }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[22rem] flex-col items-center justify-center text-center text-[#F6F1E8]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logo.sealPath} alt={brand.logo.alt} width={34} height={34} className={cn("size-[34px]", styles.fade)} />
      <p className="mt-4 text-[0.58rem] font-semibold uppercase tracking-[0.42em] text-[#C6A15B]">The One More Company</p>
      <p className={cn("mt-8 font-event text-[1.9rem] font-medium leading-tight", quiet && "text-[#F6F1E8]/60", styles.rise)}>{title}</p>
      {detail && <p className="mt-3 text-[0.75rem] leading-relaxed text-[#F6F1E8]/50">{detail}</p>}
    </div>
  );
}
