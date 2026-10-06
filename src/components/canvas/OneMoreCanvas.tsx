"use client";

import type { CSSProperties, ReactNode } from "react";
import type { EventTheme } from "@/types/event";
import { eventThemeToStyle } from "@/lib/theme";
import { Grain } from "@/components/ui/Grain";
import { CanvasAtmosphere } from "./CanvasAtmosphere";
import { CanvasProvider } from "./CanvasProvider";

interface OneMoreCanvasProps {
  campaign: EventTheme | null;
  children: ReactNode;
}

/**
 * The parent experience layer. Owns the persistent atmosphere, the scroll
 * progression and the campaign-takeover state. Movements render inside it
 * and visually blend into one continuous environment.
 */
export function OneMoreCanvas({ campaign, children }: OneMoreCanvasProps) {
  const style: CSSProperties | undefined = campaign ? eventThemeToStyle(campaign) : undefined;

  return (
    <CanvasProvider campaign={campaign}>
      <div className="relative" style={style}>
        <CanvasAtmosphere />
        {/* overflow-x: clip — fragments may escape the viewport without creating scroll */}
        <div className="relative z-10 [overflow-x:clip]">{children}</div>
        {/* one film-grain pass over the whole canvas */}
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[85] overflow-hidden">
          <Grain opacity={0.05} />
        </div>
      </div>
    </CanvasProvider>
  );
}
