"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CommunityPanel } from "./CommunityPanel";

interface CommunityContextValue {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
}

const CommunityContext = createContext<CommunityContextValue | null>(null);

export function CommunityProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openPanel, closePanel }), [open, openPanel, closePanel]);

  return (
    <CommunityContext.Provider value={value}>
      {children}
      <CommunityPanel open={open} onClose={closePanel} />
    </CommunityContext.Provider>
  );
}

export function useCommunity(): CommunityContextValue {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error("useCommunity must be used within CommunityProvider");
  return ctx;
}
