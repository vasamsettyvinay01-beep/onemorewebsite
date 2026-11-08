"use client";

import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { formatChapter } from "@/lib/events";
import { ease } from "@/lib/motion";
import { useLiveEvent } from "@/lib/availability";
import { useSalesPhase } from "@/lib/use-lifecycle";
import { ArtworkFrame } from "@/components/ui/ArtworkFrame";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { EventFacts } from "@/components/events/EventFacts";
import { MidnightArtwork } from "@/components/events/MidnightArtwork";
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
export function ExperienceTakeover({ event: staticEvent }: Props) {
  const event = useLiveEvent(staticEvent, true) ?? staticEvent;
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { takeover } = useCanvas();
  const { openFor } = useTicketSheet();
  const phase = useSalesPhase(event);
  const over = phase === "ended";
  const comingSoon = event.status === "coming-soon" || event.status === "draft";
  const selling = phase === "open" && !comingSoon;

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const strength = useTransform(scrollYProgress, [0.06, 0.28, 0.62, 0.82], [0, 1, 1, 0]);
  useMotionValueEvent(strength, "change", (v) => takeover.set(v));
  useEffect(() => () => takeover.set(0), [takeover]);

  const artY = useTransform(scrollYProgress, [0, 1], reduce ? ["0vh", "0vh"] : ["8vh", "-8vh"]);
  const artScale = useTransform(scrollYProgress, [0, 0.5, 1], reduce ? [1, 1, 1] : [1.04, 1, 1.01]);

  const artwork = event.mobileArtwork ?? event.artwork;
  const ctaLabel = event.status === "sold-out" ? "Sold out" : "Get tickets";
  const eyebrow = over
    ? event.chapter !== undefined
      ? formatChapter(event.chapter)
      : event.name
    : (event.eyebrow ?? brand.copy.nextUp);

  return (
    <div
      id={anchors.experience}
      ref={ref}
      aria-labelledby="experience-heading"
      className="relative flex min-h-[125svh] items-center py-[10svh] text-(--ev-text) sm:min-h-[120svh] sm:py-[8svh]"
    >
      <div className="mx-auto grid w-full max-w-[88rem] grid-cols-1 gap-10 px-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:items-center sm:gap-12 sm:px-12 lg:gap-20 lg:px-16">
        {/* campaign artwork — clean, high-resolution, clearly visible */}
        <motion.div
          className="w-full sm:order-2 sm:max-w-[min(100%,76svh)] sm:justify-self-end"
          style={{ y: artY, scale: artScale }}
        >
          {!artwork.src && event.theme.motif === "midnight" ? (
            <div className="relative aspect-square w-full shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)]">
              <MidnightArtwork artwork={artwork} fill />
              <div aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-[#C6A15B]/20" />
            </div>
          ) : (
            <ArtworkFrame
              artwork={artwork}
              sizes="(max-width: 640px) 100vw, 50vw"
              tone={[event.theme.primary, event.theme.secondary]}
              className="aspect-square w-full shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)]"
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
          )}
        </motion.div>

        {/* name + essentials */}
        <div className="relative z-10 sm:order-1">
          <Reveal direction="none">
            <p className="eyebrow text-[0.62rem] text-(--ev-accent)">{eyebrow}</p>
          </Reveal>

          <motion.h2
            id="experience-heading"
            className="font-headline text-event mt-5 text-(--ev-text) sm:mt-6 sm:text-[clamp(2.7rem,6.2vw,5.5rem)]"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 1.4, ease: ease.cinematic }}
          >
            {event.name}
          </motion.h2>

          {event.shortDescription && (
            <Reveal delay={0.1} className="mt-6 max-w-[38ch]">
              <p className="font-display text-[clamp(1.35rem,3.4vw,1.9rem)] italic leading-[1.15] text-(--ev-text-muted)">
                {event.shortDescription}
              </p>
            </Reveal>
          )}

          <Reveal delay={0.15} className="mt-9 max-w-[30rem] sm:mt-12">
            <EventFacts event={event} className="border-t border-white/12 pt-5" />
          </Reveal>

          {selling && (
            <Reveal delay={0.25} className="mt-9 flex flex-col items-start gap-4 sm:mt-11 xl:flex-row xl:items-center xl:gap-8">
              <Button variant="event-line" size="lg" onClick={() => openFor(event)} aria-haspopup="dialog" arrow>
                {ctaLabel}
              </Button>
              {event.status !== "on-sale" && (
                <span className="eyebrow text-[0.58rem] text-(--ev-text-muted)">
                  {event.status === "sold-out" ? "Join the list for releases" : "Community gets first access"}
                </span>
              )}
            </Reveal>
          )}

          {phase === "closed" && !comingSoon && (
            <Reveal delay={0.25} className="mt-9 sm:mt-11">
              <p className="font-display text-[clamp(2.2rem,5vw,3.4rem)] leading-none text-(--ev-text)">
                Sold <span className="italic text-(--ev-accent)">out.</span>
              </p>
            </Reveal>
          )}

          {comingSoon && !over && (
            <Reveal delay={0.25} className="mt-9 sm:mt-11">
              <p className="eyebrow flex items-center gap-3 text-[0.62rem] tracking-[0.32em] text-(--ev-accent)">
                <span aria-hidden className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--ev-accent) opacity-50 [animation-duration:2.4s]" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-(--ev-accent)" />
                </span>
                {brand.copy.comingSoon}
              </p>
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}
