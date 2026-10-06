import type { CampaignPiece } from "@/types/content";

/**
 * "What's next" slots shown after the featured event. Veiled slots render
 * blurred and untitled; their artwork is only a texture behind the blur.
 * Add as many as needed — set `revealed: true` with a real title and artwork
 * when one is announced. Artwork lives in /public/campaign/.
 */
export const campaignPieces: CampaignPiece[] = [
  {
    id: "c02",
    title: "The Vibe Just Changed",
    kind: "Launch",
    artwork: {
      src: "/campaign/vibe-just-changed.webp",
      alt: "Sculptural gold silk forms in darkness with the line “The vibe just changed.”",
      width: 1100,
      height: 1375,
    },
    tone: ["#0F100F", "#8A7349"],
    revealed: false,
  },
  {
    id: "c03",
    title: "The New Energy",
    kind: "Launch",
    artwork: {
      src: "/campaign/the-new-energy.webp",
      alt: "Gold silk forms in darkness with the One More seal — “Welcome to the new energy.”",
      width: 1100,
      height: 1375,
    },
    tone: ["#0F100F", "#4A3D28"],
    revealed: false,
  },
  {
    id: "c04",
    title: "New Vibe Unlocked",
    kind: "Poster",
    artwork: {
      src: "/campaign/new-vibe-unlocked.webp",
      alt: "The One More seal over flowing ribbons of liquid gold — “New vibe unlocked.”",
      width: 1100,
      height: 1375,
    },
    tone: ["#0A0606", "#9A5A2A"],
    revealed: false,
  },
];
