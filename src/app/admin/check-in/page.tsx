import type { Metadata } from "next";
import { CheckInPanel } from "@/components/admin/CheckInPanel";

export const metadata: Metadata = { title: "Check-in" };

export default function AdminCheckInPage() {
  return <CheckInPanel />;
}
