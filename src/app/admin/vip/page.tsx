import type { Metadata } from "next";
import { VipPanel } from "@/components/admin/VipPanel";

export const metadata: Metadata = { title: "VIP invitations" };

export default function AdminVipPage() {
  return <VipPanel />;
}
