import type { OneMoreEvent } from "@/types/event";
import { anchors } from "@/data/navigation";
import { ExperienceTakeover } from "./ExperienceTakeover";

/**
 * The lead experience. Nothing event-specific lives in components. Without an
 * announced event the world simply continues uninterrupted.
 */
export function Experience({ event }: { event: OneMoreEvent | undefined }) {
  if (!event) return <div id={anchors.experience} className="h-[10svh]" />;
  return <ExperienceTakeover key={event.id} event={event} />;
}
