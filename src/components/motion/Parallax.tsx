"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ParallaxProps {
  children: ReactNode;
  className?: string;
  /** Total vertical travel in px across the element's scroll journey. */
  range?: number;
  /** Optional horizontal travel in px. */
  rangeX?: number;
  /** Scale from → to while scrolling (subtle zoom). */
  scale?: [number, number];
  style?: React.CSSProperties;
}

/** Scroll-linked parallax wrapper. Transforms only (GPU friendly). */
export function Parallax({
  children,
  className,
  range = 60,
  rangeX = 0,
  scale,
  style,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });

  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [range, -range]);
  const x = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [rangeX, -rangeX]);
  const s = useTransform(
    scrollYProgress,
    [0, 1],
    reduce || !scale ? [1, 1] : [scale[0], scale[1]],
  );

  return (
    <motion.div ref={ref} className={cn("will-change-transform", className)} style={{ y, x, scale: s, ...style }}>
      {children}
    </motion.div>
  );
}
