import type { Metadata } from "next";
import { AuthSetup } from "@/components/auth/AuthSetup";

export const metadata: Metadata = {
  title: "Account setup",
  robots: { index: false, follow: false },
};

export default function AuthSetupPage() {
  return <AuthSetup />;
}
