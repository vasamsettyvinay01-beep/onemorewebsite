"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { ease, duration } from "@/lib/motion";
import { Grain } from "./Grain";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Accessible title id is wired automatically; pass the heading via `title`. */
  title: ReactNode;
  /** Visually hide the title (it stays available to assistive tech). */
  hideTitle?: boolean;
  children: ReactNode;
  /** `sheet` = bottom sheet on mobile, centred on desktop. `panel` = compact glass card. */
  variant?: "sheet" | "panel";
  /** Sheet only: a wide two-column stage on desktop. */
  wide?: boolean;
  className?: string;
  /** Extra classes applied to the backdrop (e.g. to tint it with an event theme). */
  backdropClassName?: string;
  backdropStyle?: React.CSSProperties;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  hideTitle,
  children,
  variant = "sheet",
  wide = false,
  className,
  backdropClassName,
  backdropStyle,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Escape + focus trap
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    document.addEventListener("keydown", onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog after the enter animation has started.
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    }, 40);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!mounted) return null;

  const isSheet = variant === "sheet";
  const enter = { opacity: 1, y: 0, scale: 1 };
  const hidden = reduce
    ? { opacity: 0, y: 0, scale: 1 }
    : isSheet
      ? { opacity: 0, y: 48, scale: 0.98 }
      : { opacity: 0, y: 24, scale: 0.97 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[90] flex",
            isSheet ? "items-end justify-center sm:items-center" : "items-end justify-center sm:items-end sm:justify-end sm:p-6",
          )}
        >
          <motion.div
            aria-hidden
            className={cn("absolute inset-0 bg-rich/70 backdrop-blur-md", backdropClassName)}
            style={backdropStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: ease.soft }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={hidden}
            animate={enter}
            exit={hidden}
            transition={{ duration: duration.sheet, ease: ease.cinematic }}
            className={cn(
              "relative w-full overflow-hidden outline-none",
              isSheet
                ? cn(
                    "max-h-[92dvh] rounded-t-[6px] sm:rounded-[3px]",
                    wide ? "sm:max-w-[30rem] md:mx-6 md:max-w-[56rem]" : "sm:max-w-[30rem]",
                  )
                : "max-h-[85dvh] rounded-t-[6px] sm:max-w-[22rem] sm:rounded-[3px]",
              "border border-ivory/10 bg-[#0d0e0d] shadow-[0_-20px_80px_-20px_rgba(0,0,0,0.8)] sm:shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]",
              className,
            )}
          >
            {/* thin gold top edge */}
            <span aria-hidden className="hairline absolute inset-x-6 top-0" />
            <Grain opacity={0.07} />
            {isSheet && !wide && (
              <span
                aria-hidden
                className="mx-auto mt-3 block h-1 w-10 rounded-full bg-ivory/25 sm:hidden"
              />
            )}
            <h2 id={titleId} className={cn(hideTitle && "sr-only")}>
              {title}
            </h2>
            <div className="relative">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
