"use client";

import { createContext, useContext, type ReactNode } from "react";

interface BrandAssets {
  /** True once public/brand/logo/one-more-production-master.svg exists. */
  logoAvailable: boolean;
}

const BrandAssetsContext = createContext<BrandAssets>({ logoAvailable: false });

export function BrandAssetsProvider({
  value,
  children,
}: {
  value: BrandAssets;
  children: ReactNode;
}) {
  return <BrandAssetsContext.Provider value={value}>{children}</BrandAssetsContext.Provider>;
}

export function useBrandAssets(): BrandAssets {
  return useContext(BrandAssetsContext);
}
