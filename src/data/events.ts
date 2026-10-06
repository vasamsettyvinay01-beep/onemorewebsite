import type { OneMoreEvent } from "@/types/event";

/**
 * Event lineup.
 *
 * Adding a future experience should mostly be a matter of:
 *   1. adding an object here,
 *   2. dropping campaign artwork into /public/events/<slug>/,
 *   3. setting `theme`, details and `ticketTiers`,
 *   4. flipping `featured: true` (and `featured: false` on the previous one).
 *
 * Only ONE event should be `featured` at a time. Details that have not been
 * announced must be left undefined — the UI shows "COMING SOON" rather than
 * inventing information.
 *
 * Example of a fully specified event (for reference, not published):
 *
 *   {
 *     id: "evt_xxx",
 *     slug: "example-night",
 *     name: "Example Night",
 *     status: "on-sale",
 *     featured: false,
 *     eyebrow: "A ONE MORE CONCEPT",
 *     shortDescription: "One line about the concept.",
 *     artwork: { src: "/events/example-night/poster.jpg", alt: "...", width: 1600, height: 2000 },
 *     theme: { primary: "#0B0C10", secondary: "#2A1C3F", accent: "#BB9B63",
 *              text: "#ECEAE4", overlayStrength: 0.55, mood: "cinematic", lighting: "cool" },
 *     date: "2027-02-14", startTime: "22:00", endTime: "03:00", timezone: "America/Chicago",
 *     venue: { name: "Venue", city: "City" }, city: "City", minimumAge: 21,
 *     ticketTiers: [{ id: "ga", name: "General Admission", priceCents: 2000, currency: "USD" }],
 *     capacity: 400,
 *   }
 */
export const events: OneMoreEvent[] = [
  {
    id: "evt_diwali_night",
    slug: "diwali-night",
    name: "Diwali Night",
    status: "coming-soon",
    featured: true,
    chapter: 1,
    eyebrow: "NEXT UP",
    artwork: {
      // Other approved Diwali artwork in /public/events/diwali-night/: punk.webp, painterly.webp, coming-soon.webp.
      src: "/events/diwali-night/premium-night.webp",
      alt: "Diwali Night — coming soon. A garlanded truck of friends with speakers under fireworks on a lantern-lit street",
      width: 1100,
      height: 1414,
      focal: "50% 45%",
    },
    theme: {
      primary: "#0B1430", // deep midnight blue
      secondary: "#7A1544", // magenta
      accent: "#E8632B", // vermilion / orange
      text: "#F6EBDD",
      textMuted: "rgba(246, 235, 221, 0.68)",
      overlayStrength: 0.45,
      mood: "festive",
      lighting: "warm",
      lights: ["#F2B134", "#C2272D", "#E8632B", "#B0205C"],
    },
    // date, startTime, endTime, venue, city, minimumAge, saleStart, saleEnd:
    // intentionally undefined — not finalised yet.
    ticketTiers: [],
  },
];
