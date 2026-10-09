import type { Metadata } from "next";
import { StaffPanel } from "@/components/admin/StaffPanel";

export const metadata: Metadata = { title: "Staff" };

export default function AdminStaffPage() {
  return <StaffPanel />;
}
