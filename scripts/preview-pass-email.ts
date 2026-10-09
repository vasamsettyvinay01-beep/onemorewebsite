// Renders the ticket email with sample data to an HTML file for design review.
//   npx deno run -A --node-modules-dir=none scripts/preview-pass-email.ts out.html
import QRCode from "npm:qrcode@1.5.4";
import { renderPassEmail } from "../supabase/functions/_shared/pass-email.ts";

const assets = "https://curprrfrkefegefqiign.supabase.co/storage/v1/object/public/brand";
const tokens = ["3f9a1c2e7b4d8a60f1e2d3c4b5a69788c21e", "8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e9f4a"];

const count = Number(Deno.args[1] ?? tokens.length);
const passes = await Promise.all(
  tokens.slice(0, count).map(async (token, i) => ({
    guest_number: i + 1,
    token,
    qrSrc: await QRCode.toDataURL(token, { width: 432, margin: 0, color: { dark: "#0F100F", light: "#F4F1EA" } }),
  })),
);

const { html } = renderPassEmail({
  name: "Vinay Vasamsetty",
  eventName: "Diwali Night",
  chapter: "01",
  dateLabel: "Saturday, November 7, 2026",
  timeLabel: "9 PM – 2 AM",
  venueName: "The Nichols Venue",
  venueAddress: "2515 Morse St, Houston, TX 77019",
  mapUrl: "https://maps.google.com",
  minimumAge: 21,
  tierName: count === 1 ? "Early Bird" : "Couple",
  invitation: "A DJ, an open floor, nine until two. Dress for the evening.",
  partner: "Pista House",
  notice: "Their food is for sale, and is not included with your pass.",
  partners: [
    { name: "Pista House", logo: `${assets}/partners/pista-house.png`, width: 819, height: 454, note: "Food and alcohol are for sale at the event, not included." },
    { name: "Pumpkin", logo: `${assets}/partners/pumpkin.png`, width: 1020, height: 432 },
    { name: "Dumont Creamery & Café", logo: `${assets}/partners/dumont.png`, width: 824, height: 232 },
  ],
  heroUrl: `${assets}/diwali-night/hero.jpg`,
  sealUrl: `${assets}/seal.png`,
  ticketsUrl: "https://theonemorecompany.com/tickets/?o=preview",
  passes,
});

await Deno.writeTextFile(Deno.args[0] ?? "pass-email-preview.html", html);
