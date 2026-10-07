"use client";

import type { OneMoreEvent, TicketTier } from "@/types/event";
import { brand } from "@/data/brand";
import { getSocial } from "@/data/socials";
import { formatTierPrice, getVisibleTiers } from "@/lib/events";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { SocialGlyph } from "@/components/community/SocialGlyph";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  onClose: () => void;
}

function tierNote(tier: TicketTier): string | undefined {
  if (tier.soldOut) return "Sold out";
  if (tier.capacity !== undefined) return `First ${tier.capacity} tickets`;
  if ((tier.admits ?? 1) > 1) return `Admits ${tier.admits}`;
  if (tier.priceOnRequest) return "Ask us on WhatsApp";
}

/** Shown while ticket sales are not open / not connected. Closing is the sheet's × button. */
export function ComingSoonState({ event }: Props) {
  const whatsapp = getSocial("whatsapp");
  const instagram = getSocial("instagram");
  const comingSoon = brand.copy.comingSoon.charAt(0) + brand.copy.comingSoon.slice(1).toLowerCase();

  const tiers = getVisibleTiers(event);
  const highlightId = tiers.find((t) => !t.soldOut)?.id;
  const venue = event.venue;

  return (
    <div className="flex flex-col">
      <SheetHeader event={event} eyebrow="Tickets" omitPlace={!!venue?.address} />
      {venue?.address && (
        <a
          href={venue.mapUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-6 mt-1.5 block w-fit text-[0.7rem] leading-relaxed tracking-[0.04em] text-ivory/55 underline decoration-ivory/20 underline-offset-4 transition-colors duration-500 hover:text-ivory hover:decoration-(--ev-accent) sm:mx-8 md:mx-10"
        >
          <span className="text-ivory/80">{venue.name}</span> · {venue.address}{" "}
          <span aria-hidden>↗</span>
        </a>
      )}

      <div className="mx-6 mt-3 border-t border-ivory/10 pt-3 sm:mx-8 md:mx-10 md:mt-5 md:pt-5">
        <div className="flex items-end justify-between gap-4">
          <p className="text-[clamp(1.5rem,4.2vw,2.1rem)] font-semibold uppercase leading-none tracking-[-0.03em] text-ivory">
            Tickets
            <span className="font-display mt-1 block normal-case italic tracking-normal text-(--ev-accent)">
              {comingSoon}.
            </span>
          </p>
          <span className="eyebrow mb-1 flex items-center gap-2 text-[0.52rem] tracking-[0.24em] text-ivory/50">
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--ev-accent) opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-(--ev-accent)" />
            </span>
            Sales open soon
          </span>
        </div>

        {tiers.length > 0 ? (
          <ul className="mt-3 grid grid-cols-2 gap-px overflow-hidden border border-ivory/10 bg-ivory/10">
            {tiers.map((t, i) => {
              const note = tierNote(t);
              return (
                <li
                  key={t.id}
                  className={cn(
                    "flex items-baseline justify-between gap-3 bg-[#0d0e0d] px-3.5 py-1.5",
                    tiers.length % 2 === 1 && i === tiers.length - 1 && "col-span-2",
                  )}
                >
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "eyebrow block text-[0.54rem] tracking-[0.2em]",
                        t.soldOut ? "text-ivory/35" : t.id === highlightId ? "text-(--ev-accent)" : "text-ivory/60",
                      )}
                    >
                      {t.name}
                    </span>
                    {note && (
                      <span
                        className={cn(
                          "mt-0.5 block text-[0.62rem] leading-tight",
                          t.soldOut ? "font-semibold uppercase tracking-[0.18em] text-(--ev-accent)" : "text-ivory/40",
                        )}
                      >
                        {note}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-display shrink-0 leading-none",
                      t.soldOut ? "text-ivory/30 line-through decoration-1" : "text-ivory",
                      t.priceOnRequest ? "text-base italic text-ivory/80" : "text-[1.45rem]",
                    )}
                  >
                    {formatTierPrice(t)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 max-w-[32ch] text-[0.82rem] leading-relaxed text-ivory-muted">
            Join the community for first access the moment they drop.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 md:px-10 md:pb-0 md:pt-5">
        <Button
          href={whatsapp.href}
          target="_blank"
          rel="noopener noreferrer"
          variant="event"
          size="lg"
          data-autofocus=""
          className="w-full"
          trailing={<SocialGlyph id="whatsapp" className="size-4" />}
        >
          First access on WhatsApp
        </Button>
        <Button
          href={instagram.href}
          target="_blank"
          rel="noopener noreferrer"
          variant="event-line"
          size="md"
          className="w-full max-md:compact:hidden"
          trailing={<SocialGlyph id="instagram" className="relative size-4" />}
        >
          Follow on Instagram
        </Button>
      </div>
    </div>
  );
}
