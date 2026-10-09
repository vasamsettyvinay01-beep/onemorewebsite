import type { Metadata } from "next";
import { DisabledPanel } from "@/components/admin/DisabledPanel";

export const metadata: Metadata = { title: "Refunds" };

export default function AdminRefundsPage() {
  return (
    <DisabledPanel
      title="Refunds"
      body="Refunds are disabled. This release cannot issue, preview, or change a refund."
    />
  );
}
