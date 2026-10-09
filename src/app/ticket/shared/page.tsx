"use client";

import { useEffect } from "react";

/** Older share links used this path. The fragment stays in the browser and is not requested. */
export default function LegacySharedRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    window.location.replace(`/tickets/shared${/^#[0-9a-f]{64}$/.test(hash) ? hash : ""}`);
  }, []);

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-md flex-col bg-[#0A0A09] px-5 py-8 text-ivory">
      <p className="mt-16 text-ivory/60">One moment…</p>
    </main>
  );
}
