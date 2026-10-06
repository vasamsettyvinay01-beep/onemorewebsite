"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface IntroState {
  /** True once the opening sequence has finished (or was skipped). Hero motion waits for this. */
  ready: boolean;
  markReady: () => void;
}

const IntroContext = createContext<IntroState>({ ready: true, markReady: () => {} });

export function IntroProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  const value = useMemo(() => ({ ready, markReady }), [ready, markReady]);
  return <IntroContext.Provider value={value}>{children}</IntroContext.Provider>;
}

export function useIntro() {
  return useContext(IntroContext);
}
