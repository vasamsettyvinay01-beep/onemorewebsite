"use client";

import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { brand } from "@/data/brand";
import { anchors, headerMenu } from "@/data/navigation";
import { cn } from "@/lib/cn";
import { ease } from "@/lib/motion";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { useCommunity } from "@/components/community/CommunityProvider";
import { useIntro } from "@/components/intro/IntroProvider";
import { MenuPanel } from "./MenuPanel";
import { SoundToggle } from "./SoundToggle";

const navItem =
  "group relative block py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory/75 transition-colors duration-500 hover:text-ivory";

/**
 * Not a navigation bar. A small emblem, two words on desktop, MENU on mobile.
 * Transparent on arrival; a scrim fades in once the page moves so the marks
 * stay legible over imagery.
 */
export function Header() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { openPanel } = useCommunity();
  const { ready } = useIntro();
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 40));

  return (
    <>
      <motion.header
        initial={{ opacity: 0 }}
        animate={ready ? { opacity: 1 } : undefined}
        transition={{ duration: 1.4, delay: 1.2, ease: ease.cinematic }}
        className="fixed inset-x-0 top-0 z-[70]"
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-[#0b0c0b]/90 to-transparent transition-opacity duration-1000",
            scrolled ? "opacity-100" : "opacity-0",
          )}
        />
        <nav
          aria-label="Primary"
          className="relative flex items-center justify-between px-6 pt-6 sm:px-12 sm:pt-8 lg:px-16"
        >
          <a href={`#${anchors.arrival}`} aria-label={`${brand.name} — back to top`} className="block">
            <BrandLogo size="sm" className="h-10 w-10 sm:h-12 sm:w-12" decorative />
          </a>

          <ul className="hidden items-center gap-11 sm:flex">
            <li>
              <SoundToggle />
            </li>
            {headerMenu.map((item) => (
              <li key={item.label}>
                {item.kind === "anchor" ? (
                  <a href={`#${item.target}`} className={navItem}>
                    {item.label}
                    <Underline />
                  </a>
                ) : (
                  <button type="button" onClick={openPanel} className={navItem}>
                    {item.label}
                    <Underline />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-6 sm:hidden">
            <SoundToggle />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={navItem}
            >
              Menu
              <Underline />
            </button>
          </div>
        </nav>
      </motion.header>

      <MenuPanel open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

function Underline() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 bottom-0.5 h-px origin-left scale-x-0 bg-gold transition-transform duration-500 ease-(--ease-cinematic) group-hover:scale-x-100"
    />
  );
}
