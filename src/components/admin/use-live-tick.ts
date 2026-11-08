"use client";

import { useEffect, useState } from "react";

/** Changes every `ms` while the tab is visible, and once when it becomes visible again. */
export function useLiveTick(ms = 10_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    };
    const id = setInterval(bump, ms);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [ms]);
  return tick;
}
