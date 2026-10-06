"use client";

import { motion } from "motion/react";
import type { OrderConfirmation } from "@/types/ticketing";
import { brand } from "@/data/brand";
import { formatChapter } from "@/lib/events";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { EmblemGhost } from "@/components/ui/EmblemGhost";

/**
 * The keepsake. A ticket designed to be screenshotted and kept: rich black
 * stock, gold hairline, the seal, the chapter number. The event's colour only
 * tints the stock — the card always reads as One More first.
 * Display only; admission is the server-issued QR, never this card.
 */
export function TicketCard({ confirmation }: { confirmation: OrderConfirmation }) {
  const ref = confirmation.orderId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 1.2, ease: ease.cinematic }}
      style={{ transformPerspective: 900 }}
      className="relative overflow-hidden rounded-[6px] border border-gold/35 bg-rich text-ivory shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--ev-secondary, #bb9b63) 26%, transparent), transparent 60%)",
        }}
      />
      <EmblemGhost className="-right-16 -top-10 w-64" opacity={0.08} />
      {/* one slow pass of light across the stock */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-gold-soft/15 to-transparent"
        initial={{ left: "-60%" }}
        animate={{ left: "130%" }}
        transition={{ duration: 1.8, delay: 0.6, ease: ease.soft }}
      />

      <div className="relative px-5 pb-5 pt-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[0.55rem] tracking-[0.3em] text-gold">{brand.name}</span>
          {confirmation.chapter !== undefined && (
            <span className="eyebrow text-[0.55rem] tracking-[0.3em] text-ivory/60">
              {formatChapter(confirmation.chapter, true)}
            </span>
          )}
        </div>

        <p className="font-display mt-6 text-[2.6rem] leading-[0.9] text-ivory">{confirmation.eventName}</p>
        {confirmation.tierName && (
          <p className="font-editorial mt-2 text-base text-ivory-muted">{confirmation.tierName}</p>
        )}

        <dl className="mt-6 grid grid-cols-3 gap-4">
          <Fact label="Date" value={confirmation.dateLabel} />
          <Fact label="Where" value={confirmation.placeLabel} />
          <Fact label="Admit" value={String(confirmation.ticketCount).padStart(2, "0")} />
        </dl>
      </div>

      {/* perforation */}
      <div aria-hidden className="relative flex items-center">
        <span className="absolute -left-2 size-4 rounded-full border border-gold/35 bg-[#0d0e0d]" />
        <span className="mx-4 h-px flex-1 border-t border-dashed border-gold/30" />
        <span className="absolute -right-2 size-4 rounded-full border border-gold/35 bg-[#0d0e0d]" />
      </div>

      <div className="relative flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow text-[0.5rem] tracking-[0.28em] text-ivory/45">Guest</p>
          <p className="mt-1 truncate text-sm font-semibold uppercase tracking-[0.14em] text-ivory">
            {confirmation.holderName ?? "—"}
          </p>
          <p className="mt-2 font-mono text-[0.62rem] tracking-[0.24em] text-gold/80">No. {ref}</p>
        </div>
        <div className="w-12 shrink-0">
          <BrandLogo size="sm" decorative />
        </div>
      </div>
    </motion.div>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-[0.5rem] tracking-[0.28em] text-ivory/45">{label}</dt>
      <dd className="mt-1.5 text-[0.7rem] font-semibold uppercase leading-snug tracking-[0.1em] text-ivory">
        {value ?? "TBA"}
      </dd>
    </div>
  );
}
