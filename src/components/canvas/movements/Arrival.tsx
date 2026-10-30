"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { ease } from "@/lib/motion";
import { formatEventDate, formatEventPlace, formatEventTime } from "@/lib/events";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { useIntro } from "@/components/intro/IntroProvider";
import { useTicketSheet } from "@/components/ticketing/TicketSheetProvider";

interface ArrivalProps {
  event?: OneMoreEvent;
}

/**
 * Opening. One focal point at a time: the mark, the name, the event that
 * matters right now, and a single way in. Everything recedes together as
 * the visitor scrolls past, rather than each piece fighting for attention.
 */
export function Arrival({ event }: ArrivalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { ready } = useIntro();
  const { openFor } = useTicketSheet();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "-6%"]);

  const chips = event
    ? [
        formatEventDate(event),
        formatEventTime(event),
        formatEventPlace(event),
        event.minimumAge ? `${event.minimumAge}+` : null,
      ].filter((v): v is string => Boolean(v))
    : [];

  const selling = event?.status === "on-sale";

  return (
    <div id={anchors.arrival} ref={ref} className="relative min-h-[100svh]">
      <motion.div
        className="page-container flex min-h-[100svh] flex-col items-center justify-center pb-10 pt-28 text-center short:pb-6 short:pt-20 sm:pb-16 sm:pt-32"
        style={{ opacity: heroOpacity, y: heroY }}
      >
        <div className="mx-auto flex max-w-xl flex-col items-center">
          <motion.div
            className="w-14 short:w-12 sm:w-[4.25rem]"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={ready ? { opacity: 1, scale: 1 } : undefined}
            transition={{ duration: 1.3, delay: 0.1, ease: ease.cinematic }}
          >
            <BrandLogo preload decorative />
          </motion.div>

          <motion.p
            className="eyebrow mt-5 text-[0.62rem] text-ivory/70"
            initial={{ opacity: 0, letterSpacing: "0.5em" }}
            animate={ready ? { opacity: 1, letterSpacing: "0.22em" } : undefined}
            transition={{ duration: 1.3, delay: 0.35, ease: ease.cinematic }}
          >
            {brand.name}
          </motion.p>

          <motion.p
            className="font-display mt-2 text-[0.92rem] italic text-ivory/35 sm:text-[1rem]"
            initial={{ opacity: 0 }}
            animate={ready ? { opacity: 1 } : undefined}
            transition={{ duration: 1.2, delay: 0.5, ease: ease.cinematic }}
          >
            {brand.tagline}
          </motion.p>

          {event ? (
            <>
              <motion.h1
                className="font-event mt-6 text-[clamp(2.5rem,11vw,5.25rem)] text-ivory short:mt-4 short:text-[2.3rem] sm:mt-8"
                initial={{ opacity: 0, y: 18 }}
                animate={ready ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 1.3, delay: 0.65, ease: ease.cinematic }}
              >
                {event.name}
              </motion.h1>

              {event.invitation && (
                <motion.p
                  className="font-display mt-4 max-w-md text-[1.1rem] italic leading-snug text-gold-soft/90 short:mt-2 short:text-base sm:text-[1.25rem]"
                  initial={{ opacity: 0 }}
                  animate={ready ? { opacity: 1 } : undefined}
                  transition={{ duration: 1.2, delay: 0.85, ease: ease.cinematic }}
                >
                  {event.invitation}
                </motion.p>
              )}

              {chips.length > 0 && (
                <motion.ul
                  className="mt-7 flex flex-wrap items-center justify-center gap-2 short:mt-4 sm:mt-8"
                  initial={{ opacity: 0 }}
                  animate={ready ? { opacity: 1 } : undefined}
                  transition={{ duration: 1.1, delay: 1.0 }}
                >
                  {chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-[2px] border border-ivory/15 px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-ivory/70"
                    >
                      {chip}
                    </li>
                  ))}
                </motion.ul>
              )}

              <motion.div
                className="mt-8 flex flex-col items-center gap-4 short:mt-5 sm:mt-10"
                initial={{ opacity: 0, y: 10 }}
                animate={ready ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 1.1, delay: 1.2, ease: ease.cinematic }}
              >
                {selling ? (
                  <>
                    <Button variant="gold" size="lg" onClick={() => openFor(event)} aria-haspopup="dialog" arrow>
                      Get tickets
                    </Button>
                    <a
                      href={`#${anchors.experience}`}
                      className="eyebrow text-[0.6rem] text-ivory/55 underline decoration-ivory/25 underline-offset-4 transition-colors hover:text-ivory hover:decoration-ivory/60"
                    >
                      View event details
                    </a>
                  </>
                ) : (
                  <Button variant="line" size="lg" href={`#${anchors.experience}`} arrow>
                    View event details
                  </Button>
                )}
              </motion.div>
            </>
          ) : (
            <motion.p
              className="eyebrow mt-8 text-[0.66rem] text-ivory/80"
              initial={{ opacity: 0, letterSpacing: "0.6em" }}
              animate={ready ? { opacity: 1, letterSpacing: "0.32em" } : undefined}
              transition={{ duration: 1.8, delay: 0.7, ease: ease.cinematic }}
            >
              We&apos;re here.
            </motion.p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
