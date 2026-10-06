"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";

/**
 * The image half of the ticket sheet. On mobile the whole artwork is shown
 * uncropped, floated on a blurred copy of itself; on desktop it fills the
 * column with a slow push-in, shaded into the panel beside it.
 */
export function TicketArtwork({ event }: { event: OneMoreEvent }) {
  const art = event.ticketArtwork ?? event.artwork;

  return (
    // on mobile the artwork gives up height first so the panel below always fits
    <div className="relative min-h-40 shrink basis-[48dvh] overflow-hidden md:h-full">
      {art.src ? (
        <>
          <Image
            src={art.src}
            alt=""
            aria-hidden
            fill
            sizes="100vw"
            className="scale-125 object-cover opacity-55 blur-2xl md:hidden"
          />
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.6, ease: ease.cinematic }}
          >
            <Image
              src={art.src}
              alt={art.alt}
              fill
              sizes="(min-width: 768px) 28rem, 100vw"
              className="object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)] md:object-cover md:drop-shadow-none"
              style={{ objectPosition: art.focal ?? "50% 50%" }}
              preload
            />
          </motion.div>
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(160deg, var(--ev-secondary), var(--ev-primary))" }}
        />
      )}

      {/* mobile: a soft fade into the panel; desktop: shade sideways into the panel */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-[#0d0e0d] md:inset-0 md:h-auto md:bg-linear-to-r md:from-transparent md:from-70% md:to-[#0d0e0d]/80"
      />
      <div aria-hidden className="absolute inset-0 hidden bg-linear-to-t from-black/55 from-0% via-transparent via-25% to-black/30 md:block" />
      <div aria-hidden className="absolute inset-3 hidden border border-gold/25 md:block" />

      <div className="absolute right-0 top-0 hidden p-8 md:block">
        <span className="block w-10">
          <BrandLogo size="sm" decorative />
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 hidden p-8 md:block">
        <span className="hairline block w-16" />
        <p className="font-editorial mt-4 text-lg text-ivory/90">Don&apos;t be the one who missed it.</p>
      </div>
    </div>
  );
}
