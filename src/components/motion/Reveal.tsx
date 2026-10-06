"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { ease, duration as dur, viewport } from "@/lib/motion";

type Direction = "up" | "none" | "mask";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  delay?: number;
  duration?: number;
  direction?: Direction;
  /** Portion of the element that must be in view before revealing. */
  amount?: number;
  as?: "div" | "span" | "p" | "h1" | "h2" | "h3" | "li";
}

/** Scroll-triggered reveal. Slow, soft, once. */
export function Reveal({
  children,
  delay = 0,
  duration = dur.reveal,
  direction = "up",
  amount = viewport.amount,
  as = "div",
  ...rest
}: RevealProps) {
  const Tag = motion[as] as typeof motion.div;

  if (direction === "mask") {
    // A fully clipped element has no intersection area, so the wrapper is
    // observed and the clipped child animates through variant propagation.
    return (
      <Tag initial="hidden" whileInView="show" viewport={{ once: true, amount }} {...rest}>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: "18%", clipPath: "inset(0 0 100% 0)" },
            show: { opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)" },
          }}
          transition={{ duration: duration * 1.2, delay, ease: ease.cinematic }}
        >
          {children}
        </motion.div>
      </Tag>
    );
  }

  const variants =
    direction === "up"
      ? { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } }
      : { hidden: { opacity: 0 }, show: { opacity: 1 } };

  return (
    <Tag
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={variants}
      transition={{ duration, delay, ease: ease.cinematic }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface RevealLinesProps {
  lines: readonly string[];
  className?: string;
  /** Per-line classes (index-matched) for asymmetric editorial layouts. */
  lineClassNames?: string[];
  stagger?: number;
  delay?: number;
  as?: "h1" | "h2" | "p";
}

/** Line-by-line masked reveal for oversized editorial headlines. */
export function RevealLines({
  lines,
  className,
  lineClassNames = [],
  stagger = 0.12,
  delay = 0,
  as: Tag = "h2",
}: RevealLinesProps) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        // The wrapper is observed (it is never clipped); the inner line animates.
        <motion.span
          key={line}
          className="block overflow-hidden pb-[0.08em] -mb-[0.08em]"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
        >
          <motion.span
            className={lineClassNames[i] ? `block ${lineClassNames[i]}` : "block"}
            variants={{ hidden: { y: "110%", opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: dur.reveal, delay: delay + i * stagger, ease: ease.cinematic }}
          >
            {line}
          </motion.span>
        </motion.span>
      ))}
    </Tag>
  );
}
