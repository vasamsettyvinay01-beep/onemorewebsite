// Renders the private VIP invitation email with sample data for design review.
//   npx deno run -A --node-modules-dir=none scripts/preview-vip-email.ts out.html [capacity]
// The QR encodes a sample string that is not a valid credential.
import QRCode from "npm:qrcode@1.5.4";
import { renderVipEmail } from "../supabase/functions/_shared/vip-email.ts";

const assets = "https://curprrfrkefegefqiign.supabase.co/storage/v1/object/public/brand";
const capacity = Number(Deno.args[1] ?? 6);

const { subject, html } = renderVipEmail({
  hostName: "Arjun Mehta",
  table: "VIP TABLE 04",
  capacity,
  event: {
    title: "Indian Diwali Night",
    date: "November 7, 2026",
    time: "9 PM – 2 AM",
    venue: "The Nichols Venue",
    city: "Houston",
    address: "2515 Morse St, Houston, TX 77019",
    mapUrl: "https://maps.google.com",
    minAge: 21,
  },
  code: "VIP-7K9M4Q",
  passUrl: "https://theonemorecompany.com/vip#preview",
  qrSrc: await QRCode.toDataURL("PREVIEW-NOT-VALID-FOR-ENTRY", {
    width: 564,
    margin: 4,
    color: { dark: "#0F0F10", light: "#F6F1E8" },
  }),
  sealUrl: `${assets}/seal.png`,
  partners: [
    { name: "Pista House", logoUrl: `${assets}/partners/pista-house.png`, width: 819, height: 454 },
    { name: "Pumpkin", logoUrl: `${assets}/partners/pumpkin.png`, width: 1020, height: 432 },
    { name: "Dumont Creamery & Café", logoUrl: `${assets}/partners/dumont.png`, width: 824, height: 232 },
  ],
});

await Deno.writeTextFile(Deno.args[0] ?? "vip-email-preview.html", html);
console.log(subject);
