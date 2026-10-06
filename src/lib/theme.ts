import type { CSSProperties } from "react";
import type { EventTheme } from "@/types/event";

/**
 * Converts an event theme into CSS custom properties. Components read
 * `var(--ev-*)` so a new campaign only needs new data, never new CSS.
 */
export function eventThemeToStyle(theme: EventTheme): CSSProperties {
  const lights = theme.lights ?? [theme.accent, theme.secondary];
  const vars: Record<string, string> = {
    "--ev-primary": theme.primary,
    "--ev-secondary": theme.secondary,
    "--ev-accent": theme.accent,
    "--ev-text": theme.text,
    "--ev-text-muted": theme.textMuted ?? "color-mix(in srgb, " + theme.text + " 65%, transparent)",
    "--ev-overlay": String(theme.overlayStrength),
    "--ev-light-1": lights[0] ?? theme.accent,
    "--ev-light-2": lights[1] ?? theme.secondary,
    "--ev-light-3": lights[2] ?? theme.accent,
    "--ev-light-4": lights[3] ?? theme.primary,
  };
  if (theme.background) vars["--ev-background"] = theme.background;
  return vars as CSSProperties;
}
