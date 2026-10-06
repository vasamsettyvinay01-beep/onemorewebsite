"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";

/**
 * The image half of the ticket sheet. A slow push-in on the campaign art,
 * shaded into the panel beside it, with the seal set quietly on top.
 */
export function TicketArtwork({ event }: { event: OneMoreEvent }) {
  const art = event.ticketArtwork ?? event.artwork;

  return (
    // on mobile the banner gives up height first so the panel below always fits
    <div className="relative min-h-28 shrink basis-[clamp(9rem,32dvh,18rem)] overflow-hidden md:h-full">
      {art.src ? (
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 9, ease: ease.cinematic }}
        >
          <Image
            src={art.src}
            alt={art.alt}
            fill
            sizes="(min-width: 768px) 32rem, 100vw"
            className="object-cover"
            style={{ objectPosition: art.focal ?? "50% 50%" }}
            preload
          />
        </motion.div>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(160deg, var(--ev-secondary), var(--ev-primary))" }}
        />
      )}

      {/* shade into the panel: downwards on mobile, sideways on desktop */}
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-b from-black/30 via-transparent via-75% to-[#0d0e0d] md:bg-linear-to-r md:via-0% md:from-transparent md:from-70% md:via-transparent md:to-[#0d0e0d]/80"
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
