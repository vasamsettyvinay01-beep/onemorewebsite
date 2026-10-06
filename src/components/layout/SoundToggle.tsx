"use client";

import { useEffect, useRef, useState } from "react";
import { brand } from "@/data/brand";
import { createAmbient, type AmbientEngine } from "@/lib/ambient";
import { cn } from "@/lib/cn";

const BARS = [0.9, 1.25, 0.75, 1.1];

/**
 * Opt-in ambient sound. Silent until pressed; the engine is only created on
 * that first gesture. Fades out when the tab is hidden and back in on return.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);
  const engine = useRef<AmbientEngine | null>(null);

  useEffect(() => {
    if (!on) return;
    const onVisibility = () => {
      if (document.hidden) engine.current?.stop();
      else void engine.current?.start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [on]);

  useEffect(() => () => engine.current?.dispose(), []);

  const toggle = async () => {
    if (on) {
      engine.current?.stop();
      setOn(false);
      return;
    }
    try {
      engine.current ??= createAmbient(brand.audio);
      setOn(true);
      await engine.current.start();
    } catch {
      setOn(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Turn ambient sound off" : "Turn ambient sound on"}
      className={cn(
        "group relative flex items-center gap-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory/75 transition-colors duration-500 hover:text-ivory",
        className,
      )}
    >
      <span aria-hidden className="flex h-3 items-end gap-[3px]">
        {BARS.map((speed, i) => (
          <span
            key={i}
            className={cn(
              "block h-full w-px origin-bottom bg-gold transition-transform duration-700",
              on ? "" : "scale-y-[0.25]",
            )}
            style={on ? { animation: `eq ${speed}s ease-in-out ${i * -0.3}s infinite` } : undefined}
          />
        ))}
      </span>
      <span className="hidden sm:inline">{on ? "Sound on" : "Sound"}</span>
    </button>
  );
}
