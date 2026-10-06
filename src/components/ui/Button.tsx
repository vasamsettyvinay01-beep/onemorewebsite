import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "gold" | "ivory" | "ghost" | "event" | "line" | "event-line";
type Size = "md" | "lg";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  trailing?: ReactNode;
  /** Trailing hairline arrow that extends on hover. */
  arrow?: boolean;
}

type ButtonAsButton = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
type ButtonAsLink = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const base =
  "group relative inline-flex items-center justify-center gap-4 overflow-hidden select-none rounded-[2px] " +
  "font-sans text-[0.68rem] font-semibold uppercase tracking-[0.18em] " +
  "transition-[background-color,color,border-color] duration-500 ease-(--ease-cinematic) " +
  "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-gold";

const variants: Record<Variant, string> = {
  gold: "bg-gold text-rich hover:bg-gold-soft",
  ivory: "bg-ivory text-rich hover:bg-white",
  ghost: "border border-ivory/20 text-ivory/85 hover:border-ivory/50 hover:text-ivory",
  event: "bg-(--ev-accent) text-(--ev-primary) hover:brightness-110",
  line: "border border-gold/60 text-ivory hover:border-gold hover:text-rich",
  "event-line": "border border-(--ev-accent) text-(--ev-text) hover:text-(--ev-primary)",
};

/** Fill that wipes in from the left on hover — line variants only. */
const wipe: Partial<Record<Variant, string>> = {
  line: "bg-gold",
  "event-line": "bg-(--ev-accent)",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-6",
  lg: "h-12 px-7",
};

export function Button(props: ButtonProps) {
  const { variant = "gold", size = "md", className, children, trailing, arrow, ...rest } = props;
  const classes = cn(base, variants[variant], sizes[size], className);
  const fill = wipe[variant];

  const inner = (
    <>
      {fill && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 origin-left scale-x-0 transition-transform duration-700 ease-(--ease-cinematic) group-hover:scale-x-100",
            fill,
          )}
        />
      )}
      <span className="relative">{children}</span>
      {trailing && <span className="relative">{trailing}</span>}
      {arrow && (
        <span aria-hidden className="relative flex items-center">
          <span className="block h-px w-6 bg-current transition-[width] duration-500 ease-(--ease-cinematic) group-hover:w-9" />
          <span className="-ml-1.5 block size-1.5 rotate-45 border-r border-t border-current" />
        </span>
      )}
    </>
  );

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...anchor } = rest as ButtonAsLink;
    return (
      <a href={href} className={classes} {...anchor}>
        {inner}
      </a>
    );
  }

  const button = rest as ButtonAsButton;
  return (
    <button type="button" className={classes} {...button}>
      {inner}
    </button>
  );
}
