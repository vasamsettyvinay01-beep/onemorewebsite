"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { campaignPieces } from "@/data/campaign";
import { anchors } from "@/data/navigation";
import { cn } from "@/lib/cn";
import { ease } from "@/lib/motion";
import type { Artwork } from "@/types/event";
import { ArtworkFrame } from "@/components/ui/ArtworkFrame";
import { SectionMark } from "@/components/ui/SectionMark";
import { Reveal } from "@/components/motion/Reveal";

const GLIMPSE_MS = 3200;

export interface FeaturedSlot {
  name: string;
  label: string;
  artwork: Artwork;
}

const itemClass = "w-[72vw] max-w-[20rem] shrink-0 snap-start lg:w-auto lg:max-w-none";
const frameClass = "relative aspect-[4/5] w-full overflow-hidden bg-rich";
const captionClass = "mt-4 flex items-baseline justify-between gap-4 border-t border-ivory/10 pt-3";

/**
 * What's next. The featured event holds the first slot, clearly shown; the
 * slots after it stay veiled — blurred and untitled — while a slow glimpse
 * travels between them. Unveiling a slot is a data change (`revealed: true`).
 */
export function LaunchSeries({ featured }: { featured: FeaturedSlot | null }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const veiled = campaignPieces.map((p, i) => (p.revealed ? -1 : i)).filter((i) => i >= 0);
  const [glimpse, setGlimpse] = useState(0);
  const nextReveal = veiled[0];
  const glimpsed = veiled[glimpse];
  const offset = featured ? 2 : 1;

  useEffect(() => {
    if (!inView || reduce || veiled.length < 2) return;
    const id = setInterval(() => setGlimpse((g) => (g + 1) % veiled.length), GLIMPSE_MS);
    return () => clearInterval(id);
  }, [inView, reduce, veiled.length]);

  return (
    <section
      ref={ref}
      id={anchors.campaign}
      aria-labelledby="launch-heading"
      className="relative py-[12svh] sm:py-[16svh]"
    >
      <div className="page-container">
        <Reveal direction="none">
          <SectionMark label="What's Next" />
        </Reveal>
        <Reveal className="mt-12 sm:mt-16">
          <h2 id="launch-heading" className="font-headline text-statement text-ivory">
            Something&apos;s coming.
          </h2>
          <p className="font-display mt-2 text-[clamp(1.8rem,4.4vw,3.4rem)] italic leading-none text-gold-soft">
            one at a time.
          </p>
        </Reveal>
      </div>

      <ul className="no-scrollbar mt-12 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 pb-2 sm:mt-16 sm:scroll-px-12 sm:px-12 lg:mx-auto lg:grid lg:max-w-[90rem] lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-16">
        {featured && (
          <Reveal as="li" className={itemClass}>
            <a href={`#${anchors.experience}`} className="group block">
              <figure className="m-0">
                <div className={frameClass}>
                  <ArtworkFrame
                    artwork={featured.artwork}
                    sizes="(max-width: 1024px) 72vw, 22vw"
                    className="size-full transition-transform duration-[1.4s] ease-(--ease-cinematic) group-hover:scale-[1.03]"
                  />
                  <div aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-gold/25" />
                </div>
                <figcaption className={captionClass}>
                  <span className="text-[0.8rem] font-semibold tracking-[-0.01em] text-ivory/90">
                    <span className="mr-2 text-gold">01</span>
                    {featured.name}
                  </span>
                  <span className="eyebrow text-[0.55rem] text-gold">{featured.label}</span>
                </figcaption>
              </figure>
            </a>
          </Reveal>
        )}

        {campaignPieces.map((piece, i) => {
          const number = String(i + offset).padStart(2, "0");
          const isGlimpsed = !piece.revealed && i === glimpsed;
          const status = piece.revealed ? piece.kind : i === nextReveal ? "Revealing next" : "Coming soon";

          return (
            <Reveal as="li" key={piece.id} delay={0.08 * (i + 1)} className={itemClass}>
              <figure className="m-0">
                <div className={frameClass}>
                  {piece.revealed ? (
                    <ArtworkFrame
                      artwork={piece.artwork}
                      tone={piece.tone}
                      sizes="(max-width: 1024px) 72vw, 22vw"
                      className="size-full"
                    />
                  ) : (
                    <>
                      <motion.div
                        aria-hidden
                        className="absolute inset-0"
                        initial={false}
                        animate={{
                          filter: isGlimpsed
                            ? "blur(9px) brightness(0.95) saturate(1)"
                            : "blur(20px) brightness(0.7) saturate(0.85)",
                          scale: isGlimpsed ? 1.08 : 1.18,
                        }}
                        transition={{ duration: 1.6, ease: ease.cinematic }}
                      >
                        <ArtworkFrame
                          artwork={{ ...piece.artwork, alt: "" }}
                          tone={piece.tone}
                          sizes="(max-width: 1024px) 40vw, 12vw"
                          className="size-full"
                        />
                      </motion.div>
                      <span className="sr-only">Upcoming — not yet revealed.</span>

                      <div aria-hidden className="absolute inset-0 bg-linear-to-b from-rich/30 via-transparent to-rich/60" />
                      <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                        <span className="font-display text-[clamp(3rem,5vw,4.5rem)] italic leading-none text-ivory/85">
                          {number}
                        </span>
                        <span className="eyebrow text-[0.56rem] tracking-[0.32em] text-gold-soft">{status}</span>
                      </div>

                      {isGlimpsed && (
                        <motion.span
                          key={`glimpse-${glimpse}`}
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-px origin-left bg-gold/80"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: GLIMPSE_MS / 1000, ease: "linear" }}
                        />
                      )}
                    </>
                  )}
                  <div aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-gold/15" />
                </div>

                <figcaption className={captionClass}>
                  <span className="text-[0.8rem] font-semibold tracking-[-0.01em] text-ivory/45">
                    {piece.revealed ? piece.title : number}
                  </span>
                  <span
                    className={cn(
                      "eyebrow text-[0.55rem] transition-colors duration-700",
                      isGlimpsed || i === nextReveal ? "text-gold" : "text-gold/50",
                    )}
                  >
                    {status}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}
