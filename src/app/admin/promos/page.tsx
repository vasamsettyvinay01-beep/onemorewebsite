import type { Metadata } from "next";
import { PromoPanel } from "@/components/admin/PromoPanel";

export const metadata: Metadata = { title: "Promo performance" };

export default function AdminPromosPage() {
  return <PromoPanel />;
}
