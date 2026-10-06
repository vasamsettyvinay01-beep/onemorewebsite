import type { SocialPlatform } from "@/types/content";

interface SocialGlyphProps {
  id: SocialPlatform;
  className?: string;
}

/** Minimal line glyphs for the community channels (not brand logos). */
export function SocialGlyph({ id, className }: SocialGlyphProps) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (id) {
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M4 20l1.3-3.9A8 8 0 1 1 8.2 19L4 20z" />
          <path d="M9.5 9.2c.2 2.3 2.8 4.9 5.1 5.1l1.1-1.1-1.6-.9-.9.6c-.9-.3-1.8-1.2-2.1-2.1l.6-.9-.9-1.6-1.3 .9z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M14 8.5V7a1.5 1.5 0 0 1 1.5-1.5H17V3h-2.3A3.7 3.7 0 0 0 11 6.7v1.8H9V11.5h2V21h3v-9.5h2.2l.5-3H14z" />
        </svg>
      );
    case "email":
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      );
  }
}
