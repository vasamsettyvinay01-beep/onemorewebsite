import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/data/brand";
import { refundPolicy } from "@/data/refund-policy";
import { RefundPolicyBody } from "@/components/policy/RefundPolicyBody";

export const metadata: Metadata = {
  title: "Refund & cancellation policy",
  description: `Ticket refund and cancellation policy for ${brand.name} events.`,
};

export default function RefundsPage() {
  return (
    <main className="page-container min-h-[100svh] py-[14svh]">
      <div className="max-w-[65ch]">
        <Link href="/" className="eyebrow text-ivory/50 transition-colors duration-500 hover:text-ivory">
          {brand.name}
        </Link>
        <h1 className="mt-6 font-headline text-[clamp(2rem,5vw,3.25rem)] leading-[1.05] text-ivory">
          {refundPolicy.title}
        </h1>
        <div className="mt-8">
          <RefundPolicyBody />
        </div>
        <p className="mt-8 text-[0.95rem] leading-relaxed text-ivory/75">
          Questions:{" "}
          <a href={`mailto:${brand.email}`} className="text-gold hover:text-gold-soft">
            {brand.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
