/**
 * Builds the images used outside the website — Stripe checkout and the ticket
 * email can't use SVG/WebP reliably — and uploads them to the public `brand`
 * bucket in the ticketing Supabase project.
 *
 *   node --env-file=.env.local scripts/pass-assets.mjs [event-slug] [artwork.webp]
 *
 * Outputs (public URLs):
 *   brand/seal.png                 gold seal, transparent — email header
 *   brand/stripe-icon.png          seal on black, square — Stripe branding icon
 *   brand/<slug>/hero.jpg          wide banner — top of the ticket email
 *   brand/<slug>/product.jpg       square — Stripe checkout product image
 */
import sharp from "sharp";

const slug = process.argv[2] ?? "diwali-night";
const artwork = process.argv[3] ?? `public/events/${slug}/dj-crowd-night.webp`;
const url = `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`;
const key = process.env.SUPABASE_SECRET_KEY;
if (!process.env.SUPABASE_PROJECT_REF || !key) throw new Error("Set SUPABASE_PROJECT_REF and SUPABASE_SECRET_KEY");

const BLACK = "#0F100F";
const auth = { apikey: key, Authorization: `Bearer ${key}` };

await fetch(`${url}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "brand", name: "brand", public: true }),
}); // 409 if it already exists — fine

async function upload(path, buffer, type) {
  const res = await fetch(`${url}/storage/v1/object/brand/${path}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": type, "x-upsert": "true", "Cache-Control": "max-age=3600" },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Upload ${path}: ${res.status} ${await res.text()}`);
  console.log(`  ${url}/storage/v1/object/public/brand/${path}`);
}

const seal = (size) => sharp("public/brand/logo/one-more-seal.svg", { density: 400 }).resize(size, size).png().toBuffer();

// Bottom fade into the email/page black so the banner melts into the pass.
const fade = (w, h) =>
  Buffer.from(
    `<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLACK}" stop-opacity="0.15"/>
      <stop offset="0.55" stop-color="${BLACK}" stop-opacity="0.25"/>
      <stop offset="1" stop-color="${BLACK}" stop-opacity="1"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );

const vignette = (s) =>
  Buffer.from(
    `<svg width="${s}" height="${s}"><defs><radialGradient id="v" cx="50%" cy="42%" r="75%">
      <stop offset="0.45" stop-color="${BLACK}" stop-opacity="0.1"/>
      <stop offset="1" stop-color="${BLACK}" stop-opacity="0.92"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#v)"/></svg>`,
  );

console.log("Uploading:");
await upload("seal.png", await seal(320), "image/png");
await upload("partners/pista-house.png", await sharp("public/brand/partners/pista-house.png").png().toBuffer(), "image/png");
await upload("partners/pumpkin.png", await sharp("public/brand/partners/pumpkin.png").png().toBuffer(), "image/png");
await upload("partners/dumont.png", await sharp("public/brand/partners/dumont.png").png().toBuffer(), "image/png");
await upload(
  "stripe-icon.png",
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BLACK } })
    .composite([{ input: await seal(400), gravity: "center" }])
    .png()
    .toBuffer(),
  "image/png",
);
await upload(
  `${slug}/hero.jpg`,
  await sharp(artwork).resize(1200, 640, { fit: "cover", position: "attention" }).modulate({ saturation: 0.9 })
    .composite([{ input: fade(1200, 640) }]).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
  "image/jpeg",
);
await upload(
  `${slug}/product.jpg`,
  await sharp(artwork).resize(1000, 1000, { fit: "cover" }).modulate({ brightness: 0.85, saturation: 0.9 })
    .composite([{ input: vignette(1000) }, { input: await seal(230), gravity: "south", top: 720, left: 385 }])
    .jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
  "image/jpeg",
);
