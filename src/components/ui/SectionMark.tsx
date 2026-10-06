import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionMarkProps {
  label: string;
  /** Optional right-aligned note on the same rule. */
  aside?: ReactNode;
  className?: string;
}

/** The brand's section signature: a small seal-gold dot, a label and a hairline rule. */
export function SectionMark({ label, aside, className }: SectionMarkProps) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-gold" />
      <span className="eyebrow text-[0.62rem] text-gold">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-linear-to-r from-gold/40 via-ivory/10 to-transparent" />
      {aside && <span className="eyebrow text-[0.58rem] text-ivory/40">{aside}</span>}
    </div>
  );
}
