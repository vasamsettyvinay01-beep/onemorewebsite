"use client";

import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { communityChannels } from "@/data/socials";
import { Dialog } from "@/components/ui/Dialog";
import { useCommunity } from "@/components/community/CommunityProvider";

interface MenuPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Mobile menu — a handful of words, nothing more. */
export function MenuPanel({ open, onClose }: MenuPanelProps) {
  const { openPanel } = useCommunity();

  const item =
    "block py-4 font-headline text-[1.75rem] text-ivory transition-colors duration-500 hover:text-gold-soft";

  return (
    <Dialog open={open} onClose={onClose} title="Menu" hideTitle variant="sheet">
      <div className="px-6 pb-8 pt-6">
        <p aria-hidden className="eyebrow text-gold">
          {brand.shortName}
        </p>
        <nav aria-label="Menu" className="mt-4 divide-y divide-ivory/10">
          <a href={`#${anchors.experience}`} onClick={onClose} className={item} data-autofocus="">
            Events
          </a>
          <button
            type="button"
            className={`${item} w-full text-left`}
            onClick={() => {
              onClose();
              openPanel();
            }}
          >
            Community
          </button>
        </nav>

        <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3">
          {communityChannels.map((c) => (
            <li key={c.id}>
              <a
                href={c.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ivory/60 transition-colors hover:text-gold-soft"
              >
                {c.label}
              </a>
            </li>
          ))}
        </ul>

        <button type="button" onClick={onClose} className="eyebrow mt-10 w-full py-3 text-center text-ivory/50 hover:text-ivory">
          Close
        </button>
      </div>
    </Dialog>
  );
}
