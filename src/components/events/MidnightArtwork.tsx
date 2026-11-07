import type { Artwork } from "@/types/event";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Grain } from "@/components/ui/Grain";

/** Radii (viewBox units, centre 500) of the light rings around the seal. */
const RINGS = [150, 196, 262, 346, 448];

/** Fixed so server and browser draw the same sky. [left %, top %, size px, delay s, duration s] */
const MOTES: [number, number, number, number, number][] = [
  [14, 78, 2, 0, 19],
  [23, 64, 1.5, 6.5, 23],
  [31, 88, 1, 2.8, 17],
  [42, 72, 2, 11, 21],
  [57, 84, 1.5, 4.2, 25],
  [66, 70, 1, 9.4, 18],
  [74, 90, 2, 1.6, 22],
  [83, 76, 1.5, 13, 20],
  [9, 92, 1, 8, 24],
  [49, 95, 1, 15.5, 19],
  [37, 58, 1, 18, 26],
  [88, 62, 1, 5.5, 21],
];

/**
 * New Year Night key art. The official seal, untouched, at the centre of
 * engraved gold rings that turn very slowly; twelve hour marks with midnight lit;
 * a single ripple of light, and a few motes rising through the dark.
 * Only transforms and opacity animate, and reduced motion holds it still.
 */
export function MidnightArtwork({
  artwork,
  className,
  seal = true,
  fill = false,
}: {
  artwork: Artwork;
  className?: string;
  seal?: boolean;
  /** Cover the positioned parent instead of sizing from `className`. */
  fill?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={artwork.alt}
      className={cn(fill ? "absolute inset-0" : "relative", "overflow-hidden bg-[#0F0F10]", className)}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 50% 0%, rgba(26,32,48,0.85) 0%, rgba(15,15,16,0) 60%), radial-gradient(60% 50% at 50% 54%, rgba(198,161,91,0.16) 0%, rgba(198,161,91,0.05) 40%, transparent 72%)",
        }}
      />

      <div aria-hidden className="absolute inset-0 animate-breathe [animation-duration:11s]">
        <div
          className="absolute left-1/2 top-[54%] aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(232,214,172,0.22) 0%, rgba(198,161,91,0.08) 45%, transparent 70%)" }}
        />
      </div>

      <svg aria-hidden viewBox="0 0 1000 1000" className="absolute left-1/2 top-[54%] h-[132%] w-[132%] -translate-x-1/2 -translate-y-1/2">
        <defs>
          <linearGradient id="midnight-ring" x1="880" y1="90" x2="160" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F6F1E8" stopOpacity="0.85" />
            <stop offset="0.3" stopColor="#C6A15B" stopOpacity="0.6" />
            <stop offset="0.7" stopColor="#C6A15B" stopOpacity="0.1" />
            <stop offset="1" stopColor="#C6A15B" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="origin-center animate-[spin_180s_linear_infinite]" style={{ transformBox: "view-box" }} fill="none" stroke="url(#midnight-ring)">
          {RINGS.map((r, i) => (
            <circle key={r} cx="500" cy="500" r={r} strokeWidth={i === 1 ? 1.5 : 0.9} strokeOpacity={1 - i * 0.16} vectorEffect="non-scaling-stroke" />
          ))}
          <circle cx="500" cy="500" r="229" strokeWidth="1.4" strokeDasharray="0.6 8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
        {/* twelve hour marks; midnight is the bright one */}
        <g stroke="#C6A15B" strokeLinecap="round">
          {Array.from({ length: 12 }, (_, hour) => (
            <line
              key={hour}
              x1="500"
              y1={hour === 0 ? 288 : 296}
              x2="500"
              y2="312"
              strokeWidth={hour === 0 ? 2.4 : 1.1}
              strokeOpacity={hour === 0 ? 0.95 : 0.32}
              transform={`rotate(${hour * 30} 500 500)`}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>

      {/* one ripple of light, every few seconds */}
      <div aria-hidden className="absolute left-1/2 top-[54%] aspect-square w-[34%] -translate-x-1/2 -translate-y-1/2">
        <span className="absolute inset-0 rounded-full border border-[#E8D6AC]/50 animate-[midnight-ripple_7s_cubic-bezier(0.16,1,0.3,1)_infinite]" />
      </div>

      <div aria-hidden className="absolute inset-0">
        {MOTES.map(([left, top, size, delay, duration]) => (
          <span
            key={`${left}-${top}`}
            className="absolute rounded-full bg-[#E8D6AC] opacity-0 shadow-[0_0_6px_rgba(232,214,172,0.9)] animate-rise"
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
          />
        ))}
      </div>

      {seal && (
        <div className="absolute left-1/2 top-[54%] w-[24%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_28px_rgba(198,161,91,0.35)]">
          <BrandLogo size="sm" decorative />
        </div>
      )}

      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(110% 85% at 50% 50%, transparent 55%, rgba(5,5,6,0.8) 100%)" }} />
      <Grain opacity={0.06} />
    </div>
  );
}
