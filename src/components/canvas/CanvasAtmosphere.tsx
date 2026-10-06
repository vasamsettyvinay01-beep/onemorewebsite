"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import { EmblemGhost } from "@/components/ui/EmblemGhost";
import { useCanvas } from "./CanvasProvider";

/** Radii (viewBox units, centre 500) of the engraved rings around the seal. */
const RINGS = [128, 162, 214, 282, 364, 458];

/**
 * Engraved gold hairlines radiating from the seal, drawn as vectors so they
 * stay razor-sharp at any resolution. A single light source catches them from
 * the upper right; turning the group with the scroll moves that light around.
 */
function HeroRings({ rotate }: { rotate: MotionValue<number> }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className="absolute left-1/2 top-[43%] h-[150vmax] w-[150vmax] -translate-x-1/2 -translate-y-1/2 sm:top-[45%]"
    >
      <defs>
        <linearGradient id="ring-light" x1="900" y1="80" x2="140" y2="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E6D3A8" stopOpacity="0.9" />
          <stop offset="0.28" stopColor="#BB9B63" stopOpacity="0.55" />
          <stop offset="0.62" stopColor="#BB9B63" stopOpacity="0.08" />
          <stop offset="1" stopColor="#BB9B63" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.g style={{ rotate, transformOrigin: "500px 500px" }} fill="none" stroke="url(#ring-light)">
        {RINGS.map((r, i) => (
          <circle
            key={r}
            cx="500"
            cy="500"
            r={r}
            strokeWidth={i === 1 ? 1.4 : 0.9}
            strokeOpacity={1 - i * 0.15}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle cx="500" cy="500" r="244" strokeWidth="1.6" strokeDasharray="0.6 7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </motion.g>
    </svg>
  );
}

/**
 * The one persistent world behind the entire homepage, built from the brand
 * kit itself: engraved gold rings around the seal open the journey, then the
 * official seal's linework turns slowly in the dark like a record. Everything sits deep
 * in ink-black so type always reads. The campaign layer fades in/out with the
 * takeover value from the Experience.
 */
export function CanvasAtmosphere() {
  const { progress, takeover, campaign } = useCanvas();

  // Engraved rings — frame the seal at arrival, recede as the story begins.
  const ringsOpacity = useTransform([progress, takeover], ([p, t]) => {
    const open = Math.max(0, 1 - (p as number) / 0.16);
    return open * (1 - (t as number));
  });
  const ringsScale = useTransform(progress, [0, 0.16], [1, 1.12]);
  const ringsRotate = useTransform(progress, [0, 0.2], [0, 40]);

  // The seal's linework turns slowly with the scroll, cropped off the right edge.
  const sealRotate = useTransform(progress, [0, 1], [-8, 28]);
  const sealY = useTransform(progress, [0, 1], ["4vh", "-18vh"]);
  const sealOpacity = useTransform([progress, takeover], ([p, t]) => {
    const v = p as number;
    const fadeIn = Math.min(1, v / 0.08);
    const fadeOut = Math.min(1, Math.max(0, (0.74 - v) / 0.1));
    return 0.045 * Math.min(fadeIn, fadeOut) * (1 - 0.7 * (t as number));
  });

  const campaignScale = useTransform(takeover, [0, 1], [1.03, 1]);
  const festive = campaign?.mood === "festive";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-rich">
      {/* ink-black base */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, #0c0d0c 0%, #0a0b0a 50%, #080908 100%)" }}
      />

      {/* engraved rings and a faint warmth behind the seal */}
      <motion.div className="absolute inset-0" style={{ opacity: ringsOpacity, scale: ringsScale }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(42% 36% at 50% 44%, rgba(187,155,99,0.09) 0%, rgba(187,155,99,0.03) 45%, transparent 75%)",
          }}
        />
        <HeroRings rotate={ringsRotate} />
      </motion.div>

      {/* the seal, turning — cropped off the right edge, clear of the type column */}
      <motion.div
        className="absolute -right-[62vw] top-[20vh] w-[120vw] max-w-none sm:-right-[34vw] sm:top-[6vh] sm:w-[68vw]"
        style={{ rotate: sealRotate, y: sealY, opacity: sealOpacity }}
      >
        <EmblemGhost
          className="relative w-full"
          opacity={1}
          fill="linear-gradient(140deg, #7d6440 0%, #bb9b63 35%, #eadbb7 52%, #bb9b63 70%, #7d6440 100%)"
        />
      </motion.div>

      {/* campaign takeover — crisp gradients from --ev-* variables, no colour fog */}
      {campaign && (
        <motion.div className="absolute inset-0" style={{ opacity: takeover, scale: campaignScale }}>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--ev-primary) 70%, #070707) 0%, color-mix(in srgb, var(--ev-primary) 88%, #070707) 55%, color-mix(in srgb, var(--ev-primary) 60%, #050505) 100%)",
            }}
          />
          {/* angled colour spill from the secondary hue */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(118deg, color-mix(in srgb, var(--ev-secondary) 42%, transparent) 0%, color-mix(in srgb, var(--ev-secondary) 12%, transparent) 30%, transparent 52%)",
            }}
          />
          {/* accent edge light low on the right */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(300deg, color-mix(in srgb, var(--ev-accent) 22%, transparent) 0%, transparent 28%)",
            }}
          />
          {festive && (
            <div
              className="absolute inset-0 animate-twinkle"
              style={{
                background:
                  "radial-gradient(1px 1px at 12% 18%, rgba(255,240,220,0.8), transparent 100%), radial-gradient(1px 1px at 84% 12%, rgba(255,240,220,0.7), transparent 100%), radial-gradient(1px 1px at 64% 42%, rgba(255,240,220,0.55), transparent 100%), radial-gradient(1px 1px at 30% 62%, rgba(255,240,220,0.7), transparent 100%), radial-gradient(1px 1px at 90% 78%, rgba(255,240,220,0.6), transparent 100%)",
              }}
            />
          )}
        </motion.div>
      )}

      {/* deep vignette — true darks at the edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 50%, rgba(5,5,5,0.75) 100%), linear-gradient(180deg, rgba(5,5,5,0.4) 0%, transparent 16%, transparent 84%, rgba(5,5,5,0.5) 100%)",
        }}
      />
    </div>
  );
}
