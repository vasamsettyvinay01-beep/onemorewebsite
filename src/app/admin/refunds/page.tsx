import type { Metadata } from "next";
import { Suspense } from "react";
import { RefundsPanel } from "@/components/admin/RefundsPanel";

export const metadata: Metadata = { title: "Refunds" };

export default function AdminRefundsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-white/50">Loading refunds…</p>}>
      <RefundsPanel />
    </Suspense>
  );
}
