"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { formatChapter } from "@/lib/events";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";

/**
 * The image half of the ticket sheet. A slow push-in on the campaign art,
 * shaded into the panel beside it, with the chapter and seal set quietly on top.
 */
export function TicketArtwork({ event }: { event: OneMoreEvent }) {
  const art = event.ticketArtwork ?? event.artwork;

  return (
    <div className="relative h-56 overflow-hidden xs:h-64 md:h-auto md:min-h-[38rem]">
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
        className="absolute inset-0 bg-linear-to-b from-black/30 via-transparent to-[#0d0e0d] md:bg-linear-to-r md:from-transparent md:via-transparent md:to-[#0d0e0d]/90"
      />
      <div aria-hidden className="absolute inset-0 hidden bg-linear-to-t from-black/60 via-transparent to-black/25 md:block" />
      <div aria-hidden className="absolute inset-3 hidden border border-gold/25 md:block" />

      <div className="absolute inset-x-0 top-0 hidden items-center justify-between p-8 md:flex">
        {event.chapter !== undefined && (
          <span className="eyebrow text-[0.58rem] tracking-[0.32em] text-ivory/85">{formatChapter(event.chapter)}</span>
        )}
        <span className="w-10">
          <BrandLogo size="sm" decorative />
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 hidden p-8 md:block">
        <span className="hairline block w-16" />
        <p className="font-editorial mt-4 text-lg text-ivory/85">A One More experience.</p>
      </div>
    </div>
  );
}
