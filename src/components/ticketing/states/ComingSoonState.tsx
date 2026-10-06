"use client";

import type { OneMoreEvent } from "@/types/event";
import { brand } from "@/data/brand";
import { getSocial } from "@/data/socials";
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

  return (
    <div className="flex flex-col">
      <SheetHeader event={event} eyebrow="Tickets" />

      <div className="relative mx-6 mt-7 overflow-hidden border-y border-ivory/10 py-8 sm:mx-8">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, color-mix(in srgb, var(--ev-secondary) 22%, transparent) 0%, transparent 55%)",
          }}
        />
        <p className="relative text-display-sm font-semibold uppercase leading-none tracking-[-0.03em] text-ivory">
          Tickets
          <span className="font-display mt-1 block normal-case italic tracking-normal text-(--ev-accent)">
            {brand.copy.comingSoon.charAt(0) + brand.copy.comingSoon.slice(1).toLowerCase()}.
          </span>
        </p>
        <p className="relative mt-4 max-w-[26ch] text-sm leading-relaxed text-ivory-muted">
          Join the community for first access the moment they drop.
        </p>
      </div>

      <div className="flex flex-col gap-3 px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
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
          Join WhatsApp
        </Button>
        <Button variant="ghost" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    </div>
  );
}
