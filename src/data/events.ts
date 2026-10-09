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
    status: "on-sale",
    featured: true,
    chapter: 1,
    eyebrow: "NEXT UP",
    artwork: {
      // Other approved Diwali artwork in /public/events/diwali-night/: premium-night.webp, punk.webp, painterly.webp, coming-soon.webp.
      src: "/events/diwali-night/dj-crowd-night.webp",
      alt: "A packed nightclub crowd with hands in the air facing the DJ on a glowing stage, lasers, gold confetti and cold-spark fountains overhead",
      width: 1600,
      height: 1600,
      focal: "50% 50%",
    },
    // Raw Recraft original: /assets/artwork-originals/diwali-ticket-comedy-icons.recraft.webp
    ticketArtwork: {
      src: "/events/diwali-night/ticket-comedy-icons.webp",
      alt: "Editorial caricature of four Indian comedy legends crashing a Diwali night in Houston — one shocked with gold tickets, one suspicious, one laughing, one dancing with a sparkler",
      width: 1400,
      height: 1900,
      focal: "50% 40%",
    },
    ticketArtworkMobile: {
      src: "/events/diwali-night/ticket-comedy-icons-square.webp",
      alt: "Editorial caricature of four Indian comedy legends crashing a Diwali night in Houston — one shocked with gold tickets, one suspicious, one laughing, one dancing with a sparkler",
      width: 1600,
      height: 1600,
      focal: "50% 52%",
    },
    checkoutArtwork: {
      src: "/events/diwali-night/checkout-backdrop.webp",
      alt: "",
      width: 2400,
      height: 1371,
      focal: "72% 50%",
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
    invitation: "A DJ, an open floor, nine until two. Dress for the evening.",
    partner: "Pista House",
    notice: "Food and alcohol are for sale at the event, and are not included with your pass.",
    partners: [
      {
        name: "Pista House",
        logo: "/brand/partners/pista-house.png",
        width: 819,
        height: 454,
        note: "Food and alcohol are for sale at the event, not included.",
      },
      {
        name: "Pumpkin",
        logo: "/brand/partners/pumpkin.png",
        width: 1020,
        height: 432,
      },
      {
        name: "Dumont Creamery & Café",
        logo: "/brand/partners/dumont.png",
        width: 824,
        height: 232,
      },
    ],
    // saleStart, saleEnd: not finalised yet.
    // Selling: run `npm run stripe:setup` after any tier change (it syncs prices to the backend),
    // then set status: "on-sale".
    ticketTiers: [
      // Every public pass is listed and can be bought. Early Bird stays on the
      // list as sold out once its 10 are gone. VIP is not listed.
      {
        id: "early-bird",
        name: "Early Bird",
        priceCents: 1499,
        currency: "USD",
        capacity: 10,
      },
      {
        id: "female",
        name: "Female",
        priceCents: 1799,
        currency: "USD",
      },
      {
        id: "general",
        name: "General Admission",
        priceCents: 1999,
        currency: "USD",
      },
      {
        id: "couple",
        name: "Couple",
        priceCents: 2999,
        currency: "USD",
        admits: 2,
      },
      {
        id: "group",
        name: "Group of 5",
        priceCents: 8999,
        currency: "USD",
        admits: 5,
      },
      {
        id: "group-8",
        name: "Group of 8",
        priceCents: 13999,
        currency: "USD",
        admits: 8,
      },
      { id: "vip", name: "VIP", priceCents: 0, currency: "USD", priceOnRequest: true, hidden: true },
    ],
  },
];
