import type { Metadata } from "next";
import { HomeStage } from "@/components/canvas/HomeStage";
import { Arrival } from "@/components/canvas/movements/Arrival";
import { Closing } from "@/components/canvas/movements/Closing";
import { Gathering } from "@/components/canvas/movements/Gathering";
import { Manifesto } from "@/components/canvas/movements/Manifesto";
import { CommunityProvider } from "@/components/community/CommunityProvider";
import { FloatingCommunityPill } from "@/components/community/FloatingCommunityPill";
import { HousePartyAnnouncement } from "@/components/house-party/HousePartyAnnouncement";
import { Intro } from "@/components/intro/Intro";
import { IntroProvider } from "@/components/intro/IntroProvider";
import { Header } from "@/components/layout/Header";
import { PointerLight } from "@/components/motion/PointerLight";
import { TicketSheetProvider } from "@/components/ticketing/TicketSheetProvider";
import { events } from "@/data/events";
import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { primaryEventAt } from "@/lib/event-end";
import { leadMetadata } from "@/lib/lead-metadata";

/** The prerender's clock. Later transitions happen in the browser; a rebuild only refreshes this. */
const builtAt = Date.now();
const lead = leadMetadata(primaryEventAt(events, new Date(builtAt)));

export const metadata: Metadata = lead
  ? {
      title: { absolute: lead.title },
      description: lead.description,
      openGraph: { title: lead.title, description: lead.description, type: "website", siteName: brand.name },
      twitter: { card: "summary_large_image", title: lead.title, description: lead.description },
    }
  : {};

/**
 * The One More Company — one continuous cinematic canvas.
 *
 * Arrival → the manifesto → the lead experience takes over the world →
 * the launch series → the gathering → the ending.
 * Components exist for maintainability; visually there are no sections.
 */
export default function HomePage() {
  return (
    <IntroProvider>
      <CommunityProvider>
        <TicketSheetProvider>
          <Intro />
          <a
            href={`#${anchors.experience}`}
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-gold focus:px-4 focus:py-2 focus:text-rich"
          >
            Skip to the next experience
          </a>
          <Header />
          <HousePartyAnnouncement />
          <PointerLight />

          <HomeStage
            builtAt={builtAt}
            opening={
              <>
                <Arrival />
                <Manifesto />
              </>
            }
            closing={
              <>
                <Gathering />
                <Closing />
              </>
            }
          />

          <FloatingCommunityPill />
        </TicketSheetProvider>
      </CommunityProvider>
    </IntroProvider>
  );
}
