/**
 * Permanent brand configuration for The One More Company.
 * Events are temporary campaigns that plug into this system; nothing in
 * this file should ever describe a single event.
 */
export const brand = {
  name: "The One More Company",
  shortName: "One More",
  tagline: "The vibe just changed.",
  description:
    "The One More Company creates elevated cultural and social experiences built around people, music, energy and moments worth remembering.",
  /** Placeholder until the real inbox is confirmed. */
  email: "hello@theonemorecompany.com",
  emailIsPlaceholder: true,
  url: "https://theonemorecompany.com",
  foundedYear: 2026,

  colors: {
    richBlack: "#0F100F",
    warmGold: "#BB9B63",
    warmIvory: "#ECEAE4",
  },

  /**
   * Official production logo. This file is the only source of the mark —
   * it must never be redrawn, rebuilt in CSS/text, or regenerated.
   *
   * Public URL: /brand/logo/one-more-production-master.svg
   * Disk path:  public/brand/logo/one-more-production-master.svg
   */
  logo: {
    publicPath: "/brand/logo/one-more-production-master.svg",
    diskPath: "public/brand/logo/one-more-production-master.svg",
    /** The official seal exported with a transparent surround — used on the page. */
    sealPath: "/brand/logo/one-more-seal.svg",
    /** Gold/ivory strokes of the official seal only, as an alpha mask. */
    sealLinesPath: "/brand/logo/one-more-seal-lines.png",
    aspectRatio: 1,
    alt: "The One More Company",
  },

  /**
   * Ambient sound behind the header toggle. Always opt-in, never autoplayed.
   * Set `src` to a looping track in /public/audio/ to replace the generated pad.
   */
  audio: {
    src: null as string | null,
    volume: 0.5,
  },

  copy: {
    hero: ["THE VIBE", "JUST CHANGED."],
    heroCue: "DISCOVER",
    statement: ["GOOD PEOPLE.", "GOOD ENERGY.", "UNFORGETTABLE EXPERIENCES."],
    nextUp: "NEXT UP",
    comingSoon: "COMING SOON",
    community: {
      headline: ["DON'T JUST WATCH", "THE VIBE."],
      sub: "BE PART OF IT.",
      pill: "JOIN THE COMMUNITY",
    },
    closing: ["WHAT'S NEXT", "IS WORTH SHOWING UP FOR."],
  },
} as const;

export type Brand = typeof brand;
