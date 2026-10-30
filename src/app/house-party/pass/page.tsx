import type { Metadata } from "next";
import { Suspense } from "react";
import { HousePartyPassView } from "@/components/house-party/HousePartyPassView";

export const metadata: Metadata = {
  title: "House Party Pass",
  robots: { index: false, follow: false },
};

export default function HousePartyPassPage() {
  return (
    <Suspense>
      <HousePartyPassView />
    </Suspense>
  );
}
