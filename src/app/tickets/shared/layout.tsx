import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared pass",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharedPassLayout({ children }: { children: React.ReactNode }) {
  return children;
}
