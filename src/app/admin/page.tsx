import type { Metadata } from "next";
import { OverviewPanel } from "@/components/admin/OverviewPanel";

export const metadata: Metadata = { title: "Overview" };

export default function AdminHomePage() {
  return <OverviewPanel />;
}
