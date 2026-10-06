"use client";

import Image from "next/image";
import { brand } from "@/data/brand";
import { cn } from "@/lib/cn";
import { useBrandAssets } from "./BrandAssetsProvider";

interface BrandLogoProps {
  className?: string;
  /** Whether this instance should be preloaded (hero only). */
  preload?: boolean;
  /** Visually hide the accessible label (the SVG already carries alt text). */
  decorative?: boolean;
  /** Controls the pending-slot treatment only; the real SVG is unaffected. */
  size?: "sm" | "lg";
}

/**
 * Renders the official seal (the brand kit's transparent export of the
 * production master), so no painted background square shows on the page.
 *
 * If the file has not been added yet, an explicit "pending" slot is drawn
 * instead. That slot is intentionally NOT a logo — the mark is never
 * recreated with text, CSS or another SVG.
 */
export function BrandLogo({
  className,
  preload = false,
  decorative = false,
  size = "lg",
}: BrandLogoProps) {
  const { logoAvailable } = useBrandAssets();

  return (
    <span
      className={cn("relative block", className)}
      style={{ aspectRatio: String(brand.logo.aspectRatio) }}
    >
      {logoAvailable ? (
        <Image
          src={brand.logo.sealPath}
          alt={decorative ? "" : brand.logo.alt}
          fill
          preload={preload}
          unoptimized
          className="object-contain"
          draggable={false}
        />
      ) : (
        <span
          data-logo-placeholder="true"
          role={decorative ? undefined : "img"}
          aria-label={decorative ? undefined : brand.logo.alt}
          className="absolute inset-0 flex items-center justify-center border border-gold/40"
        >
          {size === "lg" ? (
            <span className="eyebrow whitespace-nowrap text-[0.5rem] text-gold/70">LOGO PENDING</span>
          ) : (
            <span className="size-1 rounded-full bg-gold/60" />
          )}
        </span>
      )}
    </span>
  );
}
