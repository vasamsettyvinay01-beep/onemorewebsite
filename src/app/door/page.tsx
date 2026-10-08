import type { Metadata, Viewport } from "next";
import { DoorApp } from "@/components/door/DoorApp";

export const metadata: Metadata = {
  title: "Door",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  userScalable: false,
};

export default function DoorPage() {
  return <DoorApp />;
}
