"use client";

import { useState } from "react";
import type { OneMoreEvent } from "@/types/event";
import type { OrderConfirmation } from "@/types/ticketing";
import { getCheckoutProvider } from "@/lib/checkout";
import { isOnSale } from "@/lib/events";
import { eventThemeToStyle } from "@/lib/theme";
import { Dialog } from "@/components/ui/Dialog";
import { ComingSoonState } from "./states/ComingSoonState";
import { CheckoutState } from "./states/CheckoutState";
import { ConfirmationState } from "./states/ConfirmationState";
import { SoldOutState } from "./states/SoldOutState";
import { TicketArtwork } from "./TicketArtwork";

interface TicketSheetProps {
  open: boolean;
  event: OneMoreEvent | null;
  onClose: () => void;
}

/**
 * The single purchase overlay. Chooses its state from event status and the
 * configured checkout provider — the UI never fakes a payment.
 *
 *   coming-soon / draft           → ComingSoonState
 *   sold-out                      → SoldOutState
 *   on-sale + provider live       → CheckoutState → ConfirmationState
 *   on-sale + provider disabled   → ComingSoonState (sales not connected yet)
 */
export function TicketSheet({ open, event, onClose }: TicketSheetProps) {
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const provider = getCheckoutProvider();

  if (!event) return null;

  const live = isOnSale(event) && provider.mode === "live";
  const themeStyle = eventThemeToStyle(event.theme);

  let content: React.ReactNode;
  if (confirmation) {
    content = <ConfirmationState confirmation={confirmation} onClose={onClose} />;
  } else if (event.status === "sold-out") {
    content = <SoldOutState event={event} onClose={onClose} />;
  } else if (live) {
    content = (
      <CheckoutState
        event={event}
        provider={provider}
        onClose={onClose}
        onConfirmed={setConfirmation}
      />
    );
  } else {
    content = <ComingSoonState event={event} onClose={onClose} />;
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${event.name} — tickets`}
      hideTitle
      variant="sheet"
      wide
      backdropClassName="bg-rich/55"
      backdropStyle={{
        ...themeStyle,
        backgroundImage:
          "radial-gradient(60% 50% at 50% 100%, color-mix(in srgb, var(--ev-primary) 70%, transparent), transparent)",
      }}
    >
      <div
        style={themeStyle}
        className="max-h-[calc(92dvh-1rem)] overflow-y-auto md:grid md:max-h-none md:grid-cols-[1.05fr_1fr] md:overflow-visible"
      >
        <TicketArtwork event={event} />
        <div className="relative flex flex-col md:justify-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 hidden size-10 items-center justify-center text-ivory/50 transition-colors duration-500 hover:text-ivory md:flex"
          >
            <span aria-hidden className="relative block size-4">
              <span className="absolute left-0 top-1/2 h-px w-full rotate-45 bg-current" />
              <span className="absolute left-0 top-1/2 h-px w-full -rotate-45 bg-current" />
            </span>
          </button>
          {content}
        </div>
      </div>
    </Dialog>
  );
}
