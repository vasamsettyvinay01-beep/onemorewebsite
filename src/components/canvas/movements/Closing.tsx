"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { socials } from "@/data/socials";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { EmblemGhost } from "@/components/ui/EmblemGhost";
import { Reveal } from "@/components/motion/Reveal";
import { SocialGlyph } from "@/components/community/SocialGlyph";

/**
 * The ending of the film. The emblem returns at an enormous scale — cropped
 * at first, resolving as you reach the bottom — with the closing line and the
 * smallest possible set of links. No footer block.
 */
export function Closing() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });

  const emblemScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1.25, 1]);
  const emblemX = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["12%", "0%"]);
  const emblemOpacity = useTransform(scrollYProgress, [0, 0.5, 1], [0.03, 0.06, 0.08]);
  const year = new Date().getFullYear();

  return (
    <div id={anchors.closing} ref={ref} className="relative min-h-[92svh] overflow-hidden sm:min-h-[100svh]">
      {/* enormous emblem — official SVG as a mask, metallic fill */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-[-30%] top-[6%] w-[130vw] max-w-[90rem] sm:right-[-12%] sm:top-[-4%] sm:w-[78vw]"
        style={{ scale: emblemScale, x: emblemX, opacity: emblemOpacity }}
      >
        <EmblemGhost
          className="relative w-full"
          opacity={1}
          fill="linear-gradient(140deg, rgba(125,100,64,0.9) 0%, rgba(187,155,99,1) 35%, rgba(236,234,228,0.65) 52%, rgba(187,155,99,1) 70%, rgba(125,100,64,0.8) 100%)"
        />
      </motion.div>

      {/* deep shadow pooling at the base */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-linear-to-t from-black/70 via-black/25 to-transparent"
      />

      <div className="page-container relative z-10 flex min-h-[92svh] flex-col justify-between pb-safe pt-[14svh] sm:min-h-[100svh] sm:pt-[18svh]">
        <Reveal>
          <h2 className="text-ivory">
            <span className="font-headline block text-statement">{brand.copy.closing[0]}</span>
            <span className="font-display text-metallic mt-2 block max-w-[20ch] text-[clamp(2rem,5.4vw,4.25rem)] italic leading-[1.02]">
              {brand.copy.closing[1].charAt(0) + brand.copy.closing[1].slice(1).toLowerCase()}
            </span>
          </h2>
        </Reveal>

        <div className="mt-[18svh] pb-8 sm:mt-0">
          <Reveal className="flex items-end justify-between gap-8">
            <div className="w-20 sm:w-28">
              <BrandLogo />
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <p className="eyebrow text-[0.56rem] text-ivory/45">{brand.name}</p>
              <p className="font-editorial text-sm text-gold/70">Est. {brand.foundedYear}</p>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="mt-14 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
              {socials.map((s) => (
                <li key={s.id}>
                  <a
                    href={s.href}
                    target={s.id === "email" ? undefined : "_blank"}
                    rel={s.id === "email" ? undefined : "noopener noreferrer"}
                    className={
                      "group inline-flex items-center gap-2 py-1 text-[0.64rem] font-semibold text-ivory/65 transition-colors duration-500 hover:text-ivory " +
                      (s.id === "email" ? "tracking-[0.04em]" : "uppercase tracking-[0.16em]")
                    }
                  >
                    <SocialGlyph id={s.id} className="size-3.5 text-gold/70" />
                    {s.id === "email" ? brand.email : s.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-8 sm:justify-end">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-ivory/40">
                © {year} {brand.name}
              </p>
              <a
                href={`#${anchors.arrival}`}
                className="group inline-flex items-center gap-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-ivory/55 transition-colors duration-500 hover:text-ivory"
              >
                Back to top
                <span aria-hidden className="block h-3 w-px origin-bottom bg-gold/70 transition-transform duration-500 group-hover:scale-y-150" />
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
