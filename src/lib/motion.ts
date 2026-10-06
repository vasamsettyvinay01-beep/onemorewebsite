import type { Transition } from "motion/react";

/** Shared motion vocabulary. Slow, elegant, confident. */
export const ease = {
  cinematic: [0.16, 1, 0.3, 1] as const,
  soft: [0.4, 0, 0.2, 1] as const,
};

export const duration = {
  reveal: 1.1,
  slow: 1.6,
  sheet: 0.6,
};

export const transitions: Record<string, Transition> = {
  reveal: { duration: duration.reveal, ease: ease.cinematic },
  slow: { duration: duration.slow, ease: ease.cinematic },
  sheet: { duration: duration.sheet, ease: ease.cinematic },
};

export const viewport = { once: true, amount: 0.25 } as const;
