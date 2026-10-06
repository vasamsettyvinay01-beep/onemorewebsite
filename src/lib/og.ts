import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brand } from "@/data/brand";

/**
 * Assets for generated brand imagery (share cards, app icons).
 * The image renderer cannot read woff2 or variable fonts, so static TTF
 * instances of the brand faces live in /assets/og-fonts.
 */
const fontDir = join(process.cwd(), "assets/og-fonts");

export async function loadOgFonts() {
  const [manrope500, manrope600, serif, serifItalic] = await Promise.all([
    readFile(join(fontDir, "Manrope-500.ttf")),
    readFile(join(fontDir, "Manrope-600.ttf")),
    readFile(join(fontDir, "InstrumentSerif-Regular.ttf")),
    readFile(join(fontDir, "InstrumentSerif-Italic.ttf")),
  ]);
  return [
    { name: "Manrope", data: manrope500, weight: 500 as const, style: "normal" as const },
    { name: "Manrope", data: manrope600, weight: 600 as const, style: "normal" as const },
    { name: "Instrument Serif", data: serif, weight: 400 as const, style: "normal" as const },
    { name: "Instrument Serif", data: serifItalic, weight: 400 as const, style: "italic" as const },
  ];
}

/** The official seal as a data URI — the mark is embedded, never redrawn. */
export async function loadSealDataUri() {
  const svg = await readFile(join(process.cwd(), "public", brand.logo.sealPath));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}
