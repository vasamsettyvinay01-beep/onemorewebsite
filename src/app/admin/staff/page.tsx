import type { Metadata } from "next";
import { DisabledPanel } from "@/components/admin/DisabledPanel";

export const metadata: Metadata = { title: "Staff" };

export default function AdminStaffPage() {
  return (
    <DisabledPanel
      title="Staff"
      body="Staff management is disabled. Roles cannot be viewed or changed from this dashboard."
    />
  );
}
