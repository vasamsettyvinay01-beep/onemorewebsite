import type { Metadata } from "next";
import { TicketsPanel } from "@/components/admin/TicketsPanel";

export const metadata: Metadata = { title: "Passes" };

export default function AdminTicketsPage() {
  return <TicketsPanel />;
}
