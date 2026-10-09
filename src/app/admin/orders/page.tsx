import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersPanel } from "@/components/admin/OrdersPanel";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-white/50">Loading orders…</p>}>
      <OrdersPanel />
    </Suspense>
  );
}
