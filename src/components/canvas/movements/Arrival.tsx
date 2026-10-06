"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { useIntro } from "@/components/intro/IntroProvider";
import { SplitReveal } from "@/components/motion/SplitReveal";

/**
 * Opening. The seal is the hero — large, centred, resting on the gold silk —
 * with the launch line beneath it. As the visitor scrolls it recedes into the
 * world while the headline settles away.
 */
export function Arrival() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { ready } = useIntro();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const sealScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1, 0.82]);
  const sealY = useTransform(scrollYProgress, [0, 1], reduce ? ["0vh", "0vh"] : ["0vh", "-14vh"]);
  const sealOpacity = useTransform(scrollYProgress, [0, 0.6, 0.95], [1, 0.6, 0]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div id={anchors.arrival} ref={ref} className="relative h-[100svh] min-h-[36rem]">
      <motion.div
        className="absolute inset-x-0 top-[43%] flex -translate-y-1/2 flex-col items-center sm:top-[45%]"
        style={{ scale: sealScale, y: sealY, opacity: sealOpacity }}
      >
        <motion.div
          className="w-[68vw] max-w-[22rem] sm:w-[min(46vh,28rem)] sm:max-w-none"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={ready ? { opacity: 1, scale: 1 } : undefined}
          transition={{ duration: 1.6, delay: 0.1, ease: ease.cinematic }}
        >
          <BrandLogo preload />
        </motion.div>
        <motion.p
          className="eyebrow mt-8 text-[0.66rem] text-ivory/80 sm:mt-10"
          initial={{ opacity: 0, letterSpacing: "0.6em" }}
          animate={ready ? { opacity: 1, letterSpacing: "0.32em" } : undefined}
          transition={{ duration: 1.8, delay: 0.7, ease: ease.cinematic }}
        >
          We&apos;re here.
        </motion.p>
      </motion.div>

      <motion.div className="absolute inset-x-0 bottom-[7svh] sm:bottom-[8svh]" style={{ opacity: copyOpacity }}>
        <div className="page-container flex items-end justify-between gap-8">
          <h1 className="font-headline text-[clamp(2rem,5.6vw,4.25rem)] text-ivory">
            <SplitReveal text={brand.copy.hero[0]} play={ready} delay={0.8} />
            <SplitReveal text={brand.copy.hero[1]} play={ready} delay={1.05} className="text-gold-soft" />
          </h1>

          <motion.div
            aria-hidden
            className="hidden items-center gap-4 pb-2 sm:flex"
            initial={{ opacity: 0 }}
            animate={ready ? { opacity: 1 } : undefined}
            transition={{ duration: 1.4, delay: 1.9 }}
          >
            <span className="eyebrow text-[0.58rem] text-ivory/45">Scroll</span>
            <span className="h-px w-12 overflow-hidden bg-ivory/15">
              <span className="block h-full w-1/2 animate-marquee bg-gold/80" style={{ animationDuration: "3.2s" }} />
            </span>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
