"use client";

import type { OrderConfirmation } from "@/types/ticketing";
import { brand } from "@/data/brand";
import { Button } from "@/components/ui/Button";
import { useCommunity } from "@/components/community/CommunityProvider";
import { TicketCard } from "../TicketCard";

interface Props {
  confirmation: OrderConfirmation;
  onClose: () => void;
}

/** Post-payment screen. Reached only after a verified order. */
export function ConfirmationState({ confirmation, onClose }: Props) {
  const { openPanel } = useCommunity();
  const plural = confirmation.ticketCount === 1 ? "ticket" : "tickets";

  return (
    <div className="flex flex-col px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
      <p className="eyebrow text-(--ev-accent)">{confirmation.eventName}</p>
      <p className="mt-3 font-display text-display-md leading-[0.9] text-ivory">
        You&apos;re <span className="italic">in.</span>
      </p>
      <p className="mt-5 text-[0.78rem] uppercase tracking-[0.24em] text-ivory">
        {confirmation.ticketCount} {plural} confirmed
      </p>
      <p className="mt-2 text-sm text-ivory-muted">
        Confirmation sent to <span className="text-ivory">{confirmation.email}</span>
      </p>

      <div className="mt-8">
        <TicketCard confirmation={confirmation} />
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {confirmation.ticketsUrl && (
          <Button href={confirmation.ticketsUrl} variant="event" size="lg" className="w-full" data-autofocus="">
            View tickets
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          className="w-full"
          onClick={() => {
            onClose();
            openPanel();
          }}
        >
          {brand.copy.community.pill}
        </Button>
        <button type="button" onClick={onClose} className="eyebrow py-3 text-ivory-muted hover:text-ivory">
          Close
        </button>
      </div>
    </div>
  );
}
