/**
 * Event domain types.
 *
 * The public website, the future admin dashboard and the future ticketing
 * backend are all expected to share this shape. Keep it serialisable
 * (no Dates, no functions) so it can move between a database, an API and
 * the client without transformation.
 */

export type EventStatus =
  | "draft"
  | "coming-soon"
  | "on-sale"
  | "sold-out"
  | "past"
  | "cancelled";

/** Broad campaign direction. Components use this to pick atmosphere. */
export type EventMood = "festive" | "cinematic" | "bright" | "minimal";

export type EventLighting = "warm" | "cool" | "neutral" | "mixed";

/**
 * Campaign palette and treatment. The permanent One More brand (rich black,
 * warm gold, warm ivory) surrounds the campaign; the campaign itself may use a
 * completely different world.
 */
export interface EventTheme {
  /** Dominant background colour of the campaign world. */
  primary: string;
  /** Secondary colour used for light, gradients and depth. */
  secondary: string;
  /** Accent used for CTAs, highlights and sparks. */
  accent: string;
  /** Primary readable text colour on top of the campaign background. */
  text: string;
  /** Optional muted text colour for supporting information. */
  textMuted?: string;
  /** Optional CSS `background` for the stage (gradients, etc). */
  background?: string;
  /** 0 – 1. How strongly the artwork is dimmed behind text. */
  overlayStrength: number;
  mood: EventMood;
  lighting: EventLighting;
  /** Extra colours for ambient light bursts (sparks, bokeh). */
  lights?: string[];
}

/**
 * Artwork slot. When `src` is undefined the UI renders a theme-driven
 * placeholder, so campaign art can be dropped in later purely through data.
 */
export interface Artwork {
  src?: string;
  alt: string;
  width?: number;
  height?: number;
  /** Object-position hint, e.g. "50% 30%". */
  focal?: string;
}

export interface TicketTier {
  id: string;
  name: string;
  /** Price in the smallest currency unit (cents). */
  priceCents: number;
  currency: string;
  /** Price isn't fixed (e.g. VIP tables) — shown as "On request" and never sold through checkout. */
  priceOnRequest?: boolean;
  /** People admitted by one ticket of this tier (couple = 2, group = 5). Defaults to 1. */
  admits?: number;
  /** Id of a tier that must sell out first; this tier stays hidden until then. */
  opensAfter?: string;
  /** Flip to true once the tier's inventory is gone — it stays listed as "Sold out". */
  soldOut?: boolean;
  /** Keep the tier out of the public site for now. */
  hidden?: boolean;
  description?: string;
  /** Inventory for this tier. Undefined = unlimited / not yet set. */
  capacity?: number;
  /** Max tickets per order for this tier. */
  maxPerOrder?: number;
  saleStart?: string;
  saleEnd?: string;
}

export interface EventVenue {
  name: string;
  address?: string;
  city: string;
  region?: string;
  country?: string;
  mapUrl?: string;
}

export interface OneMoreEvent {
  id: string;
  slug: string;
  name: string;
  status: EventStatus;
  /** Whether this event is surfaced as "NEXT UP" on the homepage. */
  featured: boolean;
  /** Position in the One More series — printed as "Chapter 01" on tickets and share cards. */
  chapter?: number;
  /** Small label above the event name, e.g. "NEXT UP" or "A ONE MORE CONCEPT". */
  eyebrow?: string;
  shortDescription?: string;
  artwork: Artwork;
  mobileArtwork?: Artwork;
  /** Text-free artwork for the ticket sheet's image column. Falls back to `artwork`. */
  ticketArtwork?: Artwork;
  /** Square variant of `ticketArtwork` for the mobile sheet banner, so it fills edge to edge. */
  ticketArtworkMobile?: Artwork;
  /** Wide, text-free backdrop for /checkout with dark negative space on the left. Falls back to `ticketArtwork`. */
  checkoutArtwork?: Artwork;
  theme: EventTheme;
  /** ISO 8601 date (YYYY-MM-DD). Omit if not announced. */
  date?: string;
  /** 24h time (HH:MM) in the venue's local time. Omit if not announced. */
  startTime?: string;
  endTime?: string;
  /** IANA timezone for date/time formatting. */
  timezone?: string;
  venue?: EventVenue;
  city?: string;
  minimumAge?: number;
  /** A short note on the pass and in the pass email: the evening, in one breath. */
  invitation?: string;
  /** Named partner printed large on the pass, such as the food partner. */
  partner?: string;
  /** The plain fact under the partner name. */
  notice?: string;
  /** Brand marks shown together at the foot of the pass. */
  partners?: { name: string; logo: string; width: number; height: number; note?: string }[];
  ticketTiers: TicketTier[];
  capacity?: number;
  saleStart?: string;
  saleEnd?: string;
  /** Optional external ticketing URL if a sale ever runs off-site. */
  externalTicketUrl?: string;
}
