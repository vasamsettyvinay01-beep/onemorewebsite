"use client";

import { motion } from "motion/react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

interface SplitRevealProps {
  text: string;
  /** Start the reveal. Characters hold below their mask until this is true. */
  play: boolean;
  delay?: number;
  stagger?: number;
  className?: string;
}

/**
 * One line of display type that rises into view character by character from
 * behind its own mask, with a touch of blur that resolves as it settles.
 * Words never break mid-word; the full string stays readable to assistive tech.
 */
export function SplitReveal({ text, play, delay = 0, stagger = 0.028, className }: SplitRevealProps) {
  let index = 0;
  const words = text.split(" ");

  return (
    <span className={cn("block overflow-hidden pb-[0.06em]", className)}>
      <span className="sr-only">{text}</span>
      {words.map((word, w) => (
        <span key={w} aria-hidden>
          <span className="inline-block whitespace-nowrap">
            {Array.from(word).map((char) => {
              const i = index++;
              return (
                <motion.span
                  key={i}
                  className="inline-block will-change-transform"
                  initial={{ y: "110%", opacity: 0, filter: "blur(8px)" }}
                  animate={play ? { y: "0%", opacity: 1, filter: "blur(0px)" } : undefined}
                  transition={{ duration: 1.3, delay: delay + i * stagger, ease: ease.cinematic }}
                >
                  {char}
                </motion.span>
              );
            })}
          </span>
          {w < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
