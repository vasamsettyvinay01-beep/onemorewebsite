import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Private VIP Invitation",
  description: "A private invitation from The One More Company.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
  openGraph: { title: "Private VIP Invitation", description: "A private invitation from The One More Company." },
  twitter: { title: "Private VIP Invitation", description: "A private invitation from The One More Company." },
};

export const viewport: Viewport = {
  themeColor: "#0F0F10",
};

export default function VipLayout({ children }: { children: React.ReactNode }) {
  return children;
}
