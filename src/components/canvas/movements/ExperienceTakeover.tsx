"use client";

import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { ease } from "@/lib/motion";
import { ArtworkFrame } from "@/components/ui/ArtworkFrame";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { EventFacts } from "@/components/events/EventFacts";
import { useTicketSheet } from "@/components/ticketing/TicketSheetProvider";
import { useCanvas } from "../CanvasProvider";

interface Props {
  event: OneMoreEvent;
}

/**
 * The world is temporarily taken over by a campaign.
 *
 * As this movement travels through the viewport it writes 0 → 1 → 0 into the
 * canvas `takeover` value; the fixed atmosphere recolours accordingly. The
 * artwork, name and essentials appear inside that recoloured world — there is
 * no section box.
 */
export function ExperienceTakeover({ event }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { takeover } = useCanvas();
  const { openFor } = useTicketSheet();

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const strength = useTransform(scrollYProgress, [0.06, 0.28, 0.62, 0.82], [0, 1, 1, 0]);
  useMotionValueEvent(strength, "change", (v) => takeover.set(v));
  useEffect(() => () => takeover.set(0), [takeover]);

  const artY = useTransform(scrollYProgress, [0, 1], reduce ? ["0vh", "0vh"] : ["8vh", "-8vh"]);
  const artScale = useTransform(scrollYProgress, [0, 0.5, 1], reduce ? [1, 1, 1] : [1.04, 1, 1.01]);

  const artwork = event.mobileArtwork ?? event.artwork;
  const ctaLabel = event.status === "sold-out" ? "Sold out" : "Get tickets";

  return (
    <div
      id={anchors.experience}
      ref={ref}
      aria-labelledby="experience-heading"
      className="relative min-h-[125svh] py-[10svh] text-(--ev-text) sm:min-h-[120svh] sm:py-[8svh]"
    >
      {/* campaign artwork — clean, high-resolution, clearly visible */}
      <motion.div
        className="absolute inset-x-6 top-[8svh] sm:inset-x-auto sm:right-12 sm:top-[12svh] sm:w-[38vw] sm:max-w-[36rem] lg:right-16"
        style={{ y: artY, scale: artScale }}
      >
        <ArtworkFrame
          artwork={artwork}
          sizes="(max-width: 640px) 100vw, 38vw"
          tone={[event.theme.primary, event.theme.secondary]}
          className="aspect-[4/5] w-full shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]"
        >
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, transparent 55%, color-mix(in srgb, var(--ev-primary) 80%, black) 100%)",
              opacity: "var(--ev-overlay)",
            }}
          />
          <div aria-hidden className="absolute inset-0 ring-1 ring-inset ring-white/10" />
        </ArtworkFrame>
      </motion.div>

      {/* name + essentials */}
      <div className="relative z-10 mt-[52svh] px-6 sm:mt-[24svh] sm:w-[48vw] sm:px-12 lg:px-16">
        <Reveal direction="none">
          <p className="eyebrow text-[0.62rem] text-(--ev-accent)">{event.eyebrow ?? brand.copy.nextUp}</p>
        </Reveal>

        <motion.h2
          id="experience-heading"
          className="font-headline text-event mt-5 text-(--ev-text) sm:mt-6"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.4, ease: ease.cinematic }}
        >
          {event.name}
        </motion.h2>

        {event.shortDescription && (
          <Reveal delay={0.1} className="mt-6 max-w-[38ch]">
            <p className="text-[0.95rem] leading-[1.6] text-(--ev-text-muted)">{event.shortDescription}</p>
          </Reveal>
        )}

        <Reveal delay={0.15} className="mt-9 max-w-[30rem] sm:mt-12">
          <EventFacts event={event} className="border-t border-white/12 pt-5" />
        </Reveal>

        <Reveal delay={0.25} className="mt-9 flex flex-col items-start gap-4 sm:mt-11 sm:flex-row sm:items-center sm:gap-8">
          <Button variant="event-line" size="lg" onClick={() => openFor(event)} aria-haspopup="dialog" arrow>
            {ctaLabel}
          </Button>
          {event.status !== "on-sale" && (
            <span className="eyebrow text-[0.58rem] text-(--ev-text-muted)">
              {event.status === "sold-out" ? "Join the list for releases" : "Community gets first access"}
            </span>
          )}
        </Reveal>
      </div>
    </div>
  );
}
