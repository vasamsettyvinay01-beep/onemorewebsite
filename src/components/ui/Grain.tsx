import { cn } from "@/lib/cn";

interface GrainProps {
  className?: string;
  /** 0 – 1. Defaults to the global subtle level. */
  opacity?: number;
}

/** Reusable film-grain layer. Parent must be `position: relative` with overflow hidden. */
export function Grain({ className, opacity }: GrainProps) {
  return (
    <div
      aria-hidden
      className={cn("grain", className)}
      style={opacity !== undefined ? { opacity } : undefined}
    />
  );
}
