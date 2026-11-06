import type { Metadata } from "next";
import { CashSalePanel } from "@/components/admin/CashSalePanel";

export const metadata: Metadata = { title: "Cash sale" };

export default function AdminCashPage() {
  return <CashSalePanel />;
}
