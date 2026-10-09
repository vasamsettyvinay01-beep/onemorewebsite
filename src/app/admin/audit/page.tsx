import type { Metadata } from "next";
import { AuditPanel } from "@/components/admin/AuditPanel";

export const metadata: Metadata = { title: "Audit" };

export default function AdminAuditPage() {
  return <AuditPanel />;
}
