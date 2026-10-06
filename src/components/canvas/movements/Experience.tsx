import { anchors } from "@/data/navigation";
import { getFeaturedEvent } from "@/lib/events";
import { ExperienceTakeover } from "./ExperienceTakeover";

/**
 * The featured experience. Resolved from data on the server; nothing
 * event-specific lives in components. Without an announced event the world
 * simply continues uninterrupted.
 */
export function Experience() {
  const event = getFeaturedEvent();
  if (!event) return <div id={anchors.experience} className="h-[10svh]" />;
  return <ExperienceTakeover event={event} />;
}
