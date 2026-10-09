"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";

/**
 * The image half of the ticket sheet. On mobile a square cut of the artwork
 * fills the banner edge to edge; on desktop the portrait artwork fills the
 * column with a slow push-in, shaded into the panel beside it.
 */
export function TicketArtwork({ event }: { event: OneMoreEvent }) {
  const art = event.ticketArtwork ?? event.artwork;
  const mobileArt = event.ticketArtworkMobile ?? art;

  return (
    // on mobile the artwork gives up height first so the panel below always fits
    <div className="relative h-[9.5rem] shrink-0 overflow-hidden sm:h-[11rem] md:h-full md:min-h-0">
      {art.src ? (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: ease.cinematic }}
        >
          {mobileArt.src && (
            <Image
              src={mobileArt.src}
              alt={mobileArt.alt}
              fill
              sizes="100vw"
              className="object-cover md:hidden"
              style={{ objectPosition: mobileArt.focal ?? "50% 50%" }}
              preload
            />
          )}
          <Image
            src={art.src}
            alt={art.alt}
            fill
            sizes="28rem"
            className="hidden object-cover md:block"
            style={{ objectPosition: art.focal ?? "50% 50%" }}
          />
        </motion.div>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(160deg, var(--ev-secondary), var(--ev-primary))" }}
        />
      )}

      {/* mobile: a soft fade into the panel; desktop: shade sideways into the panel */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-b from-transparent to-[#0d0e0d] md:inset-0 md:h-auto md:bg-linear-to-r md:from-transparent md:from-70% md:to-[#0d0e0d]/80"
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-20 bg-linear-to-b from-black/45 to-transparent md:hidden" />
      <div aria-hidden className="absolute inset-0 hidden bg-linear-to-t from-black/55 from-0% via-transparent via-25% to-black/30 md:block" />
      <div aria-hidden className="absolute inset-3 hidden border border-gold/25 md:block" />

      <div className="absolute left-0 top-0 p-4 md:left-auto md:right-0 md:p-8">
        <span className="block w-8 md:w-10">
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
