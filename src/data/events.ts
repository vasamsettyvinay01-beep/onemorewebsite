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
    ticketArtwork: {
      src: "/events/diwali-night/ticket-caricature.webp",
      alt: "Caricature of five friends in Diwali outfits teasing the viewer — one fans out golden tickets, another points smugly, one yawns, one checks her watch",
      width: 1400,
      height: 1800,
      focal: "50% 72%",
    },
    ticketArtworkMobile: {
      src: "/events/diwali-night/ticket-caricature-square.webp",
      alt: "Caricature of five friends in Diwali outfits teasing the viewer — one fans out golden tickets, another points smugly, one yawns, one checks her watch",
      width: 1600,
      height: 1600,
      focal: "50% 22%",
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
    date: "2026-11-07",
    startTime: "21:00",
    endTime: "02:00",
    minimumAge: 21,
    timezone: "America/Chicago",
    venue: {
      name: "The Nichols Venue",
      address: "2515 Morse St, Houston, TX 77019",
      city: "Houston",
      region: "TX",
      country: "US",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=The+Nichols+Venue+2515+Morse+St+Houston+TX+77019",
    },
    city: "Houston",
    // saleStart, saleEnd: not finalised yet.
    ticketTiers: [
      // Set soldOut: true once all 50 are gone — that also reveals the Group of 5 tier.
      { id: "early-bird", name: "Early Bird", priceCents: 1500, currency: "USD", capacity: 50, soldOut: false },
      { id: "general", name: "General Admission", priceCents: 2000, currency: "USD" },
      { id: "couple", name: "Couple", priceCents: 3000, currency: "USD", admits: 2 },
      {
        id: "group",
        name: "Group of 5",
        priceCents: 6000,
        currency: "USD",
        admits: 5,
        opensAfter: "early-bird",
      },
      { id: "vip", name: "VIP", priceCents: 0, currency: "USD", priceOnRequest: true, hidden: true },
    ],
  },
];
