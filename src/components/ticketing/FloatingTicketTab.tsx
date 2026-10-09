"use client";

import { AnimatePresence, motion } from "motion/react";
import type { OneMoreEvent } from "@/types/event";
import { formatEventDate } from "@/lib/events";
import { ease } from "@/lib/motion";
import { useCommunity } from "@/components/community/CommunityProvider";
import { useIntro } from "@/components/intro/IntroProvider";
import { useTicketSheet } from "./TicketSheetProvider";

interface FloatingTicketTabProps {
  event: OneMoreEvent;
}

/**
 * The first thing on the page: a large, bright way into the ticket flow.
 * The sheet still carries the featured event's campaign world.
 */
export function FloatingTicketTab({ event }: FloatingTicketTabProps) {
  const { ready } = useIntro();
  const { open: communityOpen } = useCommunity();
  const { open: ticketOpen, openFor } = useTicketSheet();
  const date = formatEventDate(event);
  const city = event.city ?? event.venue?.city;
  const available = event.status !== "cancelled" && event.status !== "past";
  const onSale = event.status === "on-sale";
  const soldOut = event.status === "sold-out";
  const action = soldOut ? "View status" : onSale ? "Get tickets" : "Get access";
  const urgency = soldOut
    ? "This one went fast."
    : onSale
      ? "Before they're sold out."
      : "Before the list closes.";
  const badge = soldOut ? "Closed" : onSale ? "ASAP" : "Soon";
  const show = ready && available && !communityOpen && !ticketOpen;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.7, delay: 0.05, ease: ease.cinematic }}
          className="fixed inset-x-3 bottom-3 z-[65] pb-[env(safe-area-inset-bottom)] lg:inset-x-auto lg:bottom-auto lg:right-5 lg:top-[46%] lg:w-[18rem] lg:-translate-y-1/2 lg:pb-0 xl:right-6 xl:w-[min(28rem,calc(50vw-16rem))] 2xl:right-8 2xl:w-[min(30rem,calc(50vw-16rem))]"
        >
          <div aria-hidden className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-gold/30 blur-3xl" />
          <button
            type="button"
            onClick={() => openFor(event)}
            aria-label={`${action} for ${event.name}. ${urgency}`}
            aria-haspopup="dialog"
            className="group relative block w-full overflow-hidden rounded-[6px] border border-gold/80 bg-[#14120e]/96 text-left shadow-[0_0_70px_-8px_rgba(187,155,99,0.85),0_28px_80px_-28px_rgba(0,0,0,0.95)] backdrop-blur-xl transition-[border-color,transform,box-shadow] duration-500 ease-(--ease-cinematic) hover:border-gold-soft hover:shadow-[0_0_90px_-6px_rgba(216,193,150,0.95),0_28px_80px_-28px_rgba(0,0,0,0.95)] active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,rgba(216,193,150,0.28),transparent_52%)]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-gold-soft to-transparent"
            />

            <span className="relative block px-5 py-4 short:py-3 sm:px-6 sm:py-5 lg:px-7 lg:py-6">
              <span className="flex items-center gap-2.5">
                <span className="relative flex size-2.5 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold-soft opacity-80" />
                  <span className="relative size-2.5 rounded-full bg-gold-soft shadow-[0_0_14px_rgba(216,193,150,1)]" />
                </span>
                <span className="rounded-[2px] bg-gold px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-rich">
                  {badge}
                </span>
              </span>

              <span className="mt-3 block font-event text-[clamp(3.15rem,11vw,5.1rem)] text-metallic drop-shadow-[0_0_22px_rgba(187,155,99,0.45)] short:mt-2 short:text-[2.55rem] lg:mt-4 lg:text-[2.85rem] xl:text-[clamp(3.35rem,3.5vw,4.85rem)]">
                {event.name}
              </span>
              <span className="mt-2 block font-display text-[clamp(1.2rem,4.2vw,1.75rem)] italic leading-none text-ivory/78 lg:mt-2.5">
                {urgency}
              </span>

              {(date || city) && (
                <span className="mt-3 block text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-ivory/55 lg:mt-4">
                  {[date, city].filter(Boolean).join("  ·  ")}
                </span>
              )}

              <span className="mt-4 flex h-12 items-center justify-between bg-gold px-5 text-rich transition-colors duration-500 group-hover:bg-gold-soft short:mt-3 short:h-11 lg:mt-6 lg:h-14">
                <span className="text-[0.78rem] font-semibold uppercase tracking-[0.22em]">{action}</span>
                <span aria-hidden className="flex items-center">
                  <span className="block h-px w-8 bg-current transition-[width] duration-500 ease-(--ease-cinematic) group-hover:w-12" />
                  <span className="-ml-1.5 block size-2 rotate-45 border-r-2 border-t-2 border-current" />
                </span>
              </span>
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
