import type { Artwork } from "./event";

export interface NavItem {
  label: string;
  /** Anchor id within the single-page experience, without the hash. */
  target: string;
}

export type SocialPlatform = "whatsapp" | "instagram" | "facebook" | "email";

export interface SocialLink {
  id: SocialPlatform;
  label: string;
  /** Short line used in the community panel, e.g. "Join the community". */
  tagline: string;
  href: string;
  /** True when the href is still a placeholder that must be replaced. */
  placeholder?: boolean;
}

export interface VibeFrame {
  id: string;
  word: string;
  caption: string;
}

export interface CampaignPiece {
  id: string;
  title: string;
  /** Short category label e.g. "POSTER", "CAMPAIGN", "LAUNCH". */
  kind: string;
  artwork: Artwork;
  /** Two colours used to paint the placeholder when no artwork exists yet. */
  tone: [string, string];
  /** False keeps the piece veiled (blurred, untitled) as an upcoming reveal. */
  revealed: boolean;
}
