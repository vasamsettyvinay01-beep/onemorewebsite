import type { SocialLink, SocialPlatform } from "@/types/content";
import { brand } from "./brand";

/**
 * Single source of truth for every community / social destination.
 * Components must import from here — never hardcode URLs.
 *
 * Facebook is a PLACEHOLDER until the real page is supplied.
 */
export const socials: SocialLink[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    tagline: "Join the community",
    href: "https://chat.whatsapp.com/G73AYmssB4DElgUK0EU6ja",
    placeholder: false,
  },
  {
    id: "instagram",
    label: "Instagram",
    tagline: "Follow the vibe",
    href: "https://www.instagram.com/theonemore.company",
    placeholder: false,
  },
  {
    id: "facebook",
    label: "Facebook",
    tagline: "Stay connected",
    href: "https://facebook.com/REPLACE_WITH_PAGE",
    placeholder: true,
  },
  {
    id: "email",
    label: "Email",
    tagline: "Say hello",
    href: `mailto:${brand.email}`,
    placeholder: brand.emailIsPlaceholder,
  },
];

export function getSocial(id: SocialPlatform): SocialLink {
  const link = socials.find((s) => s.id === id);
  if (!link) throw new Error(`Unknown social link: ${id}`);
  return link;
}

/** The three community channels, in the order they should be presented. */
export const communityChannels = (["whatsapp", "instagram", "facebook"] as const).map(
  getSocial,
);
