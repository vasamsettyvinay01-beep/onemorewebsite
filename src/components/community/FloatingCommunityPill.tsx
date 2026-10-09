"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { ease } from "@/lib/motion";
import { useTicketSheet } from "@/components/ticketing/TicketSheetProvider";
import { useCommunity } from "./CommunityProvider";

/**
 * Persistent "JOIN THE COMMUNITY" control. A quiet typographic mark, not a
 * chat widget. Appears after arrival; steps aside wherever it would compete
 * (campaign takeover, the gathering, the ending) and while overlays are open.
 */
export function FloatingCommunityPill() {
  const { open: panelOpen, openPanel } = useCommunity();
  const { open: sheetOpen } = useTicketSheet();
  const { scrollY } = useScroll();
  const [pastArrival, setPastArrival] = useState(false);
  const [occluded, setOccluded] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => setPastArrival(v > window.innerHeight * 0.8));

  useEffect(() => {
    const targets = [anchors.experience, anchors.gathering, anchors.closing]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (targets.length === 0) return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setOccluded(visible.size > 0);
      },
      { threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  const show = pastArrival && !occluded && !panelOpen && !sheetOpen;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.7, ease: ease.cinematic }}
          className="fixed bottom-[17.5rem] right-0 z-[60] pr-6 short:bottom-[15rem] sm:bottom-[20rem] sm:pr-12 lg:bottom-0 lg:pb-safe lg:pr-16"
        >
          <button
            type="button"
            onClick={openPanel}
            className="group mb-4 flex items-center gap-3 py-2 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-ivory/80 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)] transition-colors duration-500 hover:text-ivory sm:mb-7"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-gold animate-breathe" />
            <span className="relative">
              {brand.copy.community.pill}
              <span aria-hidden className="absolute inset-x-0 -bottom-1 h-px origin-left scale-x-100 bg-ivory/25 transition-colors duration-500 group-hover:bg-gold" />
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
