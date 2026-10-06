"use client";

import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { getSocial } from "@/data/socials";
import { formatEventDate, formatEventPlace } from "@/lib/events";
import { Button } from "@/components/ui/Button";
import { SocialGlyph } from "@/components/community/SocialGlyph";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  onClose: () => void;
}

/** Shown while ticket sales are not open / not connected. */
export function ComingSoonState({ event, onClose }: Props) {
  const whatsapp = getSocial("whatsapp");
  const instagram = getSocial("instagram");
  const comingSoon = brand.copy.comingSoon.charAt(0) + brand.copy.comingSoon.slice(1).toLowerCase();

  const spec = [
    { label: "Date", value: formatEventDate(event) ?? "To be announced" },
    { label: "Venue", value: formatEventPlace(event) ?? "To be announced" },
    { label: "Tickets", value: comingSoon, live: true },
  ];

  return (
    <div className="flex flex-col">
      <SheetHeader event={event} eyebrow="Tickets" />

      <div className="relative mx-6 mt-8 overflow-hidden border-t border-ivory/10 pt-8 sm:mx-8 md:mx-10">
        <p className="text-display-sm font-semibold uppercase leading-none tracking-[-0.03em] text-ivory">
          Tickets
          <span className="font-display mt-1 block normal-case italic tracking-normal text-(--ev-accent)">
            {comingSoon}.
          </span>
        </p>
        <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-ivory-muted">
          Join the community for first access the moment they drop.
        </p>

        <dl className="mt-8 divide-y divide-ivory/10 border-y border-ivory/10">
          {spec.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-6 py-3.5">
              <dt className="eyebrow text-[0.58rem] tracking-[0.26em] text-ivory/45">{row.label}</dt>
              <dd className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ivory/85">
                {row.live && (
                  <span aria-hidden className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--ev-accent) opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-(--ev-accent)" />
                  </span>
                )}
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3 px-6 pb-6 pt-8 sm:px-8 sm:pb-8 md:px-10 md:pb-12">
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
          Get first access on WhatsApp
        </Button>
        <Button
          href={instagram.href}
          target="_blank"
          rel="noopener noreferrer"
          variant="event-line"
          size="lg"
          className="w-full"
          trailing={<SocialGlyph id="instagram" className="relative size-4" />}
        >
          Follow on Instagram
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="eyebrow mt-2 self-center py-2 text-[0.6rem] text-ivory/45 transition-colors duration-500 hover:text-ivory md:hidden"
        >
          Close
        </button>
      </div>
    </div>
  );
}
