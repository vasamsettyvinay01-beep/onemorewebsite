"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { brand } from "@/data/brand";
import { ease } from "@/lib/motion";
import { useBrandAssets } from "@/components/ui/BrandAssetsProvider";
import { INTRO_STORAGE_KEY } from "./intro-key";
import { useIntro } from "./IntroProvider";

/** When the seal has drawn and the hero takes over (ms). Matches the CSS draw/shimmer timing. */
const HANDOFF_MS = 2900;

const sealMask = `url("${brand.logo.sealLinesPath}") center / contain no-repeat`;
const sweepMask = "conic-gradient(#000 calc(var(--sweep) - 14deg), transparent var(--sweep))";

const drawLayer: CSSProperties = {
  WebkitMask: `${sealMask}, ${sweepMask}`,
  mask: `${sealMask}, ${sweepMask}`,
  WebkitMaskComposite: "source-in",
  maskComposite: "intersect",
};

/**
 * Opening sequence, once per session. The official seal's line extraction is
 * traced in by a circular sweep, catches the light, then dissolves onto the
 * hero seal, which sits in exactly the same place. Skipped for reduced motion,
 * deep links, returning visits within the session and when the logo is absent.
 */
export function Intro() {
  const { logoAvailable } = useBrandAssets();
  const { ready, markReady } = useIntro();
  const [phase, setPhase] = useState<"playing" | "leaving" | "gone">("playing");
  const finished = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const skip =
      !logoAvailable ||
      root.dataset.intro === "seen" ||
      window.location.hash.length > 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (skip) {
      markReady();
      return;
    }

    root.style.overflow = "hidden";
    window.scrollTo(0, 0);

    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      root.style.overflow = "";
      try {
        sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
      } catch {}
      setPhase("leaving");
      markReady();
    };

    const timer = window.setTimeout(finish, HANDOFF_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", finish);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", finish);
      root.style.overflow = "";
    };
  }, [logoAvailable, markReady]);

  // ready while still "playing" means the sequence was skipped outright
  if (!logoAvailable || phase === "gone" || (ready && phase === "playing")) return null;
  const leaving = phase === "leaving";

  return (
    <motion.div
      data-intro-overlay
      aria-hidden
      className="fixed inset-0 z-[95] overflow-hidden bg-rich"
      initial={false}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 1.4, ease: ease.soft }}
      style={{ pointerEvents: leaving ? "none" : "auto" }}
      onAnimationComplete={() => leaving && setPhase("gone")}
    >
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 42%, rgba(187,155,99,0.10), transparent 55%)" }}
      />

      {/* mirrors the Arrival seal block so the handoff lands pixel-for-pixel */}
      <div className="relative h-[100svh] min-h-[36rem]">
        <div className="absolute inset-x-0 top-[43%] flex -translate-y-1/2 flex-col items-center sm:top-[45%]">
          <div className="w-[68vw] max-w-[22rem] sm:w-[min(46vh,28rem)] sm:max-w-none">
            <div className="relative" style={{ aspectRatio: String(brand.logo.aspectRatio) }}>
              {/* blur sits on a wrapper so it applies after the mask, not before */}
              <div className="absolute inset-0 opacity-60 blur-[14px]">
                <div className="intro-draw intro-metal absolute inset-0" style={drawLayer} />
              </div>
              <div className="intro-draw intro-metal absolute inset-0" style={drawLayer} />
            </div>
          </div>
          <motion.p
            className="eyebrow mt-8 text-[0.66rem] text-gold-soft/80 sm:mt-10"
            initial={{ opacity: 0, letterSpacing: "0.7em" }}
            animate={{ opacity: leaving ? 0 : 1, letterSpacing: "0.32em" }}
            transition={{ duration: leaving ? 0.6 : 1.8, delay: leaving ? 0 : 0.9, ease: ease.cinematic }}
          >
            {brand.name}
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
