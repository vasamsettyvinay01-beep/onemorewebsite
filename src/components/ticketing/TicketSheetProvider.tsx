"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OneMoreEvent } from "@/types/event";
import { TicketSheet } from "./TicketSheet";

interface TicketSheetContextValue {
  open: boolean;
  event: OneMoreEvent | null;
  openFor: (event: OneMoreEvent) => void;
  close: () => void;
}

const TicketSheetContext = createContext<TicketSheetContextValue | null>(null);

/** Owns the single ticket overlay for the whole page. */
export function TicketSheetProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<OneMoreEvent | null>(null);
  const [open, setOpen] = useState(false);

  const openFor = useCallback((e: OneMoreEvent) => {
    setEvent(e);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ open, event, openFor, close }), [open, event, openFor, close]);

  return (
    <TicketSheetContext.Provider value={value}>
      {children}
      <TicketSheet open={open} event={event} onClose={close} />
    </TicketSheetContext.Provider>
  );
}

export function useTicketSheet(): TicketSheetContextValue {
  const ctx = useContext(TicketSheetContext);
  if (!ctx) throw new Error("useTicketSheet must be used within TicketSheetProvider");
  return ctx;
}
