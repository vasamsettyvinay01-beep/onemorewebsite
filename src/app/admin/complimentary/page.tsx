import type { Metadata } from "next";
import { ComplimentaryPanel } from "@/components/admin/ComplimentaryPanel";

export const metadata: Metadata = { title: "Complimentary tickets" };

export default function AdminComplimentaryPage() {
  return <ComplimentaryPanel />;
}
