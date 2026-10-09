import { OneMoreCanvas } from "@/components/canvas/OneMoreCanvas";
import { Arrival } from "@/components/canvas/movements/Arrival";
import { Closing } from "@/components/canvas/movements/Closing";
import { Experience } from "@/components/canvas/movements/Experience";
import { Gathering } from "@/components/canvas/movements/Gathering";
import { LaunchSeries } from "@/components/canvas/movements/LaunchSeries";
import { Manifesto } from "@/components/canvas/movements/Manifesto";
import { CommunityProvider } from "@/components/community/CommunityProvider";
import { FloatingCommunityPill } from "@/components/community/FloatingCommunityPill";
import { Intro } from "@/components/intro/Intro";
import { IntroProvider } from "@/components/intro/IntroProvider";
import { Header } from "@/components/layout/Header";
import { PointerLight } from "@/components/motion/PointerLight";
import { FloatingTicketTab } from "@/components/ticketing/FloatingTicketTab";
import { TicketSheetProvider } from "@/components/ticketing/TicketSheetProvider";
import { anchors } from "@/data/navigation";
import { getFeaturedEvent } from "@/lib/events";

/**
 * The One More Company — one continuous cinematic canvas.
 *
 * Arrival → the manifesto → the featured experience takes over the world →
 * the launch series → the gathering → the ending.
 * Components exist for maintainability; visually there are no sections.
 */
export default function HomePage() {
  const featured = getFeaturedEvent();
  const campaign = featured?.theme ?? null;
  const featuredSlot = featured
    ? { name: featured.name, label: featured.eyebrow ?? "Next up", artwork: featured.artwork }
    : null;

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
          <PointerLight />

          <OneMoreCanvas campaign={campaign}>
            <main>
              <Arrival />
              <Manifesto />
              <Experience />
              <LaunchSeries featured={featuredSlot} />
              <Gathering />
              <Closing />
            </main>
          </OneMoreCanvas>

          {featured && <FloatingTicketTab event={featured} />}
          <FloatingCommunityPill />
        </TicketSheetProvider>
      </CommunityProvider>
    </IntroProvider>
  );
}
