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
      backdropClassName="bg-rich/55"
      backdropStyle={{
        ...themeStyle,
        backgroundImage:
          "radial-gradient(60% 50% at 50% 100%, color-mix(in srgb, var(--ev-primary) 70%, transparent), transparent)",
      }}
    >
      <div style={themeStyle}>{content}</div>
    </Dialog>
  );
}
