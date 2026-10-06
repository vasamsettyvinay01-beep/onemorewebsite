"use client";

import { brand } from "@/data/brand";
import { cn } from "@/lib/cn";
import { useBrandAssets } from "./BrandAssetsProvider";

interface EmblemGhostProps {
  className?: string;
  /** CSS fill painted through the emblem silhouette. */
  fill?: string;
  /** Opacity of the ghost (0 – 1). */
  opacity?: number;
}

/**
 * Oversized, barely-visible emblem geometry used as background texture.
 * The official seal's line extraction is used as a CSS mask so the mark
 * itself is never redrawn. When the logo is absent nothing is drawn.
 */
export function EmblemGhost({
  className,
  fill = "linear-gradient(135deg, rgba(187,155,99,0.9), rgba(236,234,228,0.35) 60%, rgba(187,155,99,0.6))",
  opacity = 0.06,
}: EmblemGhostProps) {
  const { logoAvailable } = useBrandAssets();
  const maskUrl = `url("${brand.logo.sealLinesPath}")`;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{ aspectRatio: String(brand.logo.aspectRatio), opacity }}
    >
      {logoAvailable ? (
        <div
          className="absolute inset-0"
          style={{
            background: fill,
            WebkitMaskImage: maskUrl,
            maskImage: maskUrl,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      ) : null}
    </div>
  );
}
