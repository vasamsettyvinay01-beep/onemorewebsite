import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { Artwork } from "@/types/event";
import { cn } from "@/lib/cn";
import { Grain } from "./Grain";

interface ArtworkFrameProps {
  artwork: Artwork;
  className?: string;
  /** Responsive sizes hint for next/image. */
  sizes?: string;
  preload?: boolean;
  /** Two colours used for the placeholder painting when no `src` exists. */
  tone?: [string, string];
  /** Optional index/label shown very subtly on placeholders. */
  label?: string;
  /** Extra overlay content (gradients, captions). */
  children?: ReactNode;
  imageClassName?: string;
  style?: CSSProperties;
}

/**
 * Full-bleed image container. Renders next/image when a source exists,
 * otherwise a layered, grain-textured placeholder painted from `tone`.
 * Swapping in a real image is purely a data change.
 */
export function ArtworkFrame({
  artwork,
  className,
  sizes = "100vw",
  preload = false,
  tone = ["#1a1a16", "#3a3225"],
  label,
  children,
  imageClassName,
  style,
}: ArtworkFrameProps) {
  const [a, b] = tone;
  return (
    <div className={cn("relative overflow-hidden", className)} style={style}>
      {artwork.src ? (
        <Image
          src={artwork.src}
          alt={artwork.alt}
          fill
          sizes={sizes}
          quality={90}
          preload={preload}
          className={cn("object-cover", imageClassName)}
          style={{ objectPosition: artwork.focal }}
        />
      ) : (
        <div aria-label={artwork.alt} role="img" className={cn("absolute inset-0", imageClassName)}>
          {/* dark-graded surface painted from the tone */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(155deg, color-mix(in srgb, ${b} 70%, #0b0b0a) 0%, color-mix(in srgb, ${a} 80%, #0b0b0a) 48%, #0b0b0a 100%)`,
            }}
          />
          {/* angled light plane — a crisp edge, like light across card stock */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(118deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.03) 34%, transparent 34.4%, transparent 100%)",
            }}
          />
          {/* bottom grade so type can sit on it */}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(180deg, transparent 45%, rgba(8,8,7,0.55) 100%)" }}
          />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/[0.06]" />
          <Grain opacity={0.09} />
          {label && (
            <span className="eyebrow absolute bottom-4 left-4 text-[0.6rem] text-white/45">
              {label}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
