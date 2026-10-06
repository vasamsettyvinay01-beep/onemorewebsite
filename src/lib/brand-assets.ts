import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { brand } from "@/data/brand";

/**
 * Server-side check for the official logo file. The site never recreates
 * the mark; if the SVG is missing, components render an honest stand-in and
 * the build logs a warning so it is impossible to ship without noticing.
 */
export function isLogoAvailable(): boolean {
  // Statically scoped so the bundler only traces this one folder.
  const available = existsSync(
    path.join(process.cwd(), "public", "brand", "logo", "one-more-production-master.svg"),
  );
  if (!available && process.env.NODE_ENV !== "test") {
    console.warn(
      `[brand] Official logo not found at ${brand.logo.diskPath}. ` +
        "Drop the production SVG there — the site renders a temporary stand-in until then.",
    );
  }
  return available;
}
