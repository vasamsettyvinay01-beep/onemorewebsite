"use client";

import { brand } from "@/data/brand";
import { communityChannels } from "@/data/socials";
import { Dialog } from "@/components/ui/Dialog";
import { SocialGlyph } from "./SocialGlyph";

interface CommunityPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Small premium glass panel listing the three community channels. */
export function CommunityPanel({ open, onClose }: CommunityPanelProps) {
  return (
    <Dialog open={open} onClose={onClose} title={brand.copy.community.pill} hideTitle variant="panel">
      <div className="px-6 pb-6 pt-7 sm:px-7">
        <p aria-hidden className="eyebrow text-gold">
          {brand.copy.community.pill}
        </p>
        <p className="mt-3 font-display text-3xl text-ivory">
          Where the next one <span className="italic text-gold-soft">starts.</span>
        </p>

        <ul className="mt-7 divide-y divide-ivory/10 border-y border-ivory/10">
          {communityChannels.map((channel, i) => (
            <li key={channel.id}>
              <a
                href={channel.href}
                target="_blank"
                rel="noopener noreferrer"
                data-autofocus={i === 0 ? "" : undefined}
                className="group flex items-center gap-4 py-4 transition-colors duration-500 hover:text-gold-soft"
              >
                <SocialGlyph id={channel.id} className="size-5 text-gold" />
                <span className="flex-1">
                  <span className="block font-sans text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-ivory group-hover:text-gold-soft">
                    {channel.label}
                  </span>
                  <span className="block font-display text-lg leading-tight text-ivory-muted">
                    {channel.tagline}{" "}
                    <span className="inline-block transition-transform duration-500 ease-(--ease-cinematic) group-hover:translate-x-1">
                      →
                    </span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="eyebrow mt-6 w-full py-3 text-center text-ivory-muted transition-colors hover:text-ivory"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
