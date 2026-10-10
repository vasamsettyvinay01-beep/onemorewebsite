"use client";

import type { OneMoreEvent } from "@/types/event";
import { getCheckoutProvider } from "@/lib/checkout";
import { useLiveEvent } from "@/lib/availability";
import { isOnSale } from "@/lib/events";
import { eventThemeToStyle } from "@/lib/theme";
import { Dialog } from "@/components/ui/Dialog";
import { ComingSoonState } from "./states/ComingSoonState";
import { CheckoutState } from "./states/CheckoutState";
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
 *   on-sale + provider live       → CheckoutState → /checkout → /tickets
 *   on-sale + provider disabled   → ComingSoonState (sales not connected yet)
 */
export function TicketSheet({ open, event: staticEvent, onClose }: TicketSheetProps) {
  const event = useLiveEvent(staticEvent, open);

  if (!event) return null;

  const provider = getCheckoutProvider(event);
  const live = isOnSale(event) && provider.mode === "live";
  const soldOutKey = event.ticketTiers.filter((t) => t.soldOut).map((t) => t.id).join();
  const themeStyle = eventThemeToStyle(event.theme);

  let content: React.ReactNode;
  if (event.status === "sold-out") {
    content = <SoldOutState event={event} onClose={onClose} />;
  } else if (live) {
    content = <CheckoutState key={soldOutKey} event={event} provider={provider} onClose={onClose} />;
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
        className="flex h-[92dvh] max-h-[92dvh] flex-col overflow-hidden md:grid md:h-[min(40rem,calc(100dvh-2.5rem))] md:max-h-[calc(100dvh-2.5rem)] md:grid-cols-[auto_minmax(0,1fr)]"
      >
        <TicketArtwork event={event} />
        <div className="flex min-h-0 flex-1 flex-col bg-[#0c0b0a] px-0 py-4 md:py-7 md:pb-8 md:pl-2 md:pr-8">
          {content}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full bg-black/45 text-ivory/80 backdrop-blur-sm transition-colors duration-500 hover:text-ivory md:right-4 md:top-4 md:bg-transparent md:text-ivory/50 md:backdrop-blur-none"
      >
        <span aria-hidden className="relative block size-4">
          <span className="absolute left-0 top-1/2 h-px w-full rotate-45 bg-current" />
          <span className="absolute left-0 top-1/2 h-px w-full -rotate-45 bg-current" />
        </span>
      </button>
    </Dialog>
  );
}
