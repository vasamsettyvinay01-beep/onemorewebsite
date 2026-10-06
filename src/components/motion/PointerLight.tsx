"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Desktop-only, pointer-reactive soft gold light. Pure transform updates on
 * a single blurred element; disabled for touch devices and reduced motion.
 */
export function PointerLight() {
  const [enabled, setEnabled] = useState(false);
  const reduce = useReducedMotion();
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 40, damping: 20, mass: 1.2 });
  const sy = useSpring(y, { stiffness: 40, damping: 20, mass: 1.2 });

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine) and (min-width: 1024px)");
    const update = () => setEnabled(fine.matches && !reduce);
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, [reduce]);

  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled, x, y]);

  if (!enabled) return null;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[5] size-[32rem] rounded-full mix-blend-screen"
      style={{
        x: sx,
        y: sy,
        translateX: "-50%",
        translateY: "-50%",
        background:
          "radial-gradient(closest-side, rgba(187,155,99,0.06), rgba(187,155,99,0.02) 45%, transparent 70%)",
      }}
    />
  );
}
