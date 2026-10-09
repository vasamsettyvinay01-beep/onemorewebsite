import type { Metadata } from "next";
import { EventsPanel } from "@/components/admin/EventsPanel";

export const metadata: Metadata = { title: "Events" };

export default function AdminEventsPage() {
  return <EventsPanel />;
}
