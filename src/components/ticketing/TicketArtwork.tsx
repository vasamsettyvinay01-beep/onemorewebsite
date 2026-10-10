"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";

/**
 * The image half of the ticket sheet. Mobile uses a wide cut of the room.
 * Desktop keeps the portrait at its own ratio so the photograph is not cropped.
 */
export function TicketArtwork({ event }: { event: OneMoreEvent }) {
  const art = event.ticketArtwork ?? event.artwork;
  const mobileArt = event.ticketArtworkMobile ?? art;

  return (
    <div className="relative h-[7.25rem] shrink-0 overflow-hidden short:h-24 sm:h-[10.5rem] md:h-full md:w-[calc(min(40rem,100dvh-2.5rem)*665/1024)] md:shrink-0">
      {art.src ? (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.04 }}
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
            sizes="26rem"
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

      <div aria-hidden className="absolute inset-x-0 bottom-0 h-14 bg-linear-to-b from-transparent to-[#0c0b0a] md:hidden" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/45 to-transparent md:h-20 md:from-black/30" />
      <div aria-hidden className="absolute inset-y-0 right-0 hidden w-16 bg-linear-to-r from-transparent to-[#0c0b0a] md:block" />

      <div className="absolute left-0 top-0 p-4 md:p-6">
        <span className="block w-8 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] md:w-9">
          <BrandLogo size="sm" decorative />
        </span>
      </div>
    </div>
  );
}
