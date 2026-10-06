/**
 * Copies the official brand kit into /public at web sizes.
 *
 *   node scripts/ingest-brand.mjs "C:\path\to\onemore"
 *
 * The production SVG is copied byte-for-byte. Everything else is a resized
 * export of an existing brand file — nothing here draws or alters the mark.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const kit = path.join(process.argv[2] ?? "C:/Users/vinay/OneDrive/Desktop/onemore", "brand");
const pub = path.resolve("public");
sharp.cache(false);

function out(rel) {
  const file = path.join(pub, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

async function webp(srcRel, destRel, width, { quality = 92, upscale = false } = {}) {
  const src = path.isAbsolute(srcRel) ? srcRel : path.join(kit, srcRel);
  const info = await sharp(src, { limitInputPixels: false })
    .resize({ width, kernel: "lanczos3", withoutEnlargement: !upscale })
    .webp({ quality, effort: 6, smartSubsample: true })
    .toFile(out(destRel));
  console.log(`${destRel}  ${info.width}x${info.height}  ${Math.round(info.size / 1024)}KB`);
  return info;
}

// Logo ----------------------------------------------------------------------
copyFileSync(path.join(kit, "logo/one-more-production-master.svg"), out("brand/logo/one-more-production-master.svg"));
console.log("brand/logo/one-more-production-master.svg  (verbatim)");

// Vector seal for on-page display: the production master with only its
// background square removed, so it renders razor-sharp at any size.
{
  const master = readFileSync(path.join(kit, "logo/one-more-production-master.svg"), "utf8");
  const seal = master.replace(/<rect\b[^>]*\/>\s*/, "");
  if (seal === master) throw new Error("Expected a background <rect> in the production master");
  writeFileSync(out("brand/logo/one-more-seal.svg"), seal);
  console.log("brand/logo/one-more-seal.svg  (master minus background square)");
}

// Line-only extraction of the official seal: the gold and ivory strokes become
// opaque, the dark disc becomes transparent. Used as a CSS mask.
{
  const { data, info } = await sharp(path.join(kit, "logo/one-more-emblem-transparent-4k.png"))
    .resize({ width: 3072, kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const outBuf = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const t = Math.min(1, Math.max(0, (lum - 0.12) / 0.38));
    const line = t * t * (3 - 2 * t);
    outBuf[i * 4] = 255;
    outBuf[i * 4 + 1] = 255;
    outBuf[i * 4 + 2] = 255;
    outBuf[i * 4 + 3] = Math.round(line * a);
  }
  const res = await sharp(outBuf, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(out("brand/logo/one-more-seal-lines.png"));
  console.log(`brand/logo/one-more-seal-lines.png  ${res.width}x${res.height}  ${Math.round(res.size / 1024)}KB`);
}

// Launch series — seal + liquid gold on ink only, one theme ------------------------
const posters = [
  ["posters/launch-carousel/02-vibe-changed-instagram.png", "campaign/vibe-just-changed.webp"],
  ["posters/launch-carousel/03-new-energy-instagram.png", "campaign/the-new-energy.webp"],
  ["posters/one-more-funky-poster.png", "campaign/new-vibe-unlocked.webp"],
];
for (const [src, dest] of posters) await webp(src, dest, 2160);

// Events -------------------------------------------------------------------------
await webp("posters/diwali/diwali-night-coming-soon-instagram.png", "events/diwali-night/coming-soon.webp", 2160);
await webp("posters/diwali/diwali-night-punk-poster.png", "events/diwali-night/punk.webp", 2160);
await webp("posters/diwali/diwali-night-premium-night-poster.png", "events/diwali-night/premium-night.webp", 2160);
await webp("posters/diwali/diwali-night-poster.png", "events/diwali-night/painterly.webp", 2160);
