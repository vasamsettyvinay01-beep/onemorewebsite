import type { Metadata } from "next";
import { HousePartyRsvpExperience } from "@/components/house-party/HousePartyRsvpExperience";

export const metadata: Metadata = {
  title: "House Party RSVP",
  description: "Private Diwali × Halloween House Party RSVP.",
  robots: { index: false, follow: false },
};

export default function HousePartyPage() {
  return <HousePartyRsvpExperience />;
}
