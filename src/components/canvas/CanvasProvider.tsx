"use client";

import { useMotionValue, useScroll, type MotionValue } from "motion/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { EventTheme } from "@/types/event";

interface CanvasContextValue {
  /** 0 – 1 progress through the whole page. Drives the slow evolution of the world. */
  progress: MotionValue<number>;
  /**
   * 0 – 1 strength of the campaign takeover. Set by the Experience movement as it
   * passes through the viewport; read by the atmosphere to recolour the world.
   */
  takeover: MotionValue<number>;
  /** Theme of the featured event, if any — the colours the takeover paints with. */
  campaign: EventTheme | null;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function CanvasProvider({
  campaign,
  children,
}: {
  campaign: EventTheme | null;
  children: ReactNode;
}) {
  const { scrollYProgress } = useScroll();
  const takeover = useMotionValue(0);
  const value = useMemo(
    () => ({ progress: scrollYProgress, takeover, campaign }),
    [scrollYProgress, takeover, campaign],
  );
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas must be used inside OneMoreCanvas");
  return ctx;
}
