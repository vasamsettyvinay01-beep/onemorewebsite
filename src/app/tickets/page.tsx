import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsView } from "@/components/ticketing/TicketsView";

export const metadata: Metadata = {
  title: "Your tickets",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function TicketsPage() {
  return (
    <Suspense>
      <TicketsView />
    </Suspense>
  );
}
