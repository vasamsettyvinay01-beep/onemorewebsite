"use client";

import type { OneMoreEvent } from "@/types/event";
import { getSocial } from "@/data/socials";
import { Button } from "@/components/ui/Button";
import { SheetHeader } from "./SheetHeader";

interface Props {
  event: OneMoreEvent;
  onClose: () => void;
}

export function SoldOutState({ event, onClose }: Props) {
  const whatsapp = getSocial("whatsapp");
  return (
    <div className="flex flex-col">
      <SheetHeader event={event} eyebrow="Tickets" />
      <div className="mx-6 mt-7 border-y border-ivory/10 py-8 sm:mx-8">
        <p className="font-display text-display-sm leading-[0.9] text-ivory">
          Sold <span className="italic text-(--ev-accent)">out.</span>
        </p>
        <p className="mt-4 max-w-[28ch] text-sm leading-relaxed text-ivory-muted">
          Releases and last-minute drops are announced to the community first.
        </p>
      </div>
      <div className="flex flex-col gap-3 px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
        <Button href={whatsapp.href} target="_blank" rel="noopener noreferrer" variant="event" size="lg" className="w-full" data-autofocus="">
          Join WhatsApp
        </Button>
        <Button variant="ghost" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    </div>
  );
}
