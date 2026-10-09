import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/data/brand";

export const metadata: Metadata = {
  title: "Refund & cancellation policy",
  description: `Ticket refund and cancellation policy for ${brand.name} events.`,
};

export default function RefundsPage() {
  const heading = "mt-10 eyebrow text-gold";
  const body = "mt-3 text-[0.95rem] leading-relaxed text-ivory/75";

  return (
    <main className="page-container min-h-[100svh] py-[14svh]">
      <div className="max-w-[60ch]">
        <Link href="/" className="eyebrow text-ivory/50 transition-colors duration-500 hover:text-ivory">
          {brand.name}
        </Link>
        <h1 className="mt-6 font-headline text-[clamp(2rem,5vw,3.25rem)] leading-[1.05] text-ivory">
          Refund &amp; cancellation policy
        </h1>

        <h2 className={heading}>All sales are final</h2>
        <p className={body}>
          Tickets are non-refundable. We don&apos;t offer refunds, returns or exchanges, including if you can&apos;t
          attend or are refused entry for not meeting the event&apos;s age or ID requirements.
        </p>

        <h2 className={heading}>If we cancel the event</h2>
        <p className={body}>
          If {brand.name} cancels an event, every ticket holder gets a full refund of what they paid, including tax,
          to the original payment method. You don&apos;t need to do anything. Refunds usually show up within 5–10
          business days.
        </p>

        <h2 className={heading}>If the event is postponed</h2>
        <p className={body}>
          If an event moves to a new date, your ticket stays valid for the new date.
        </p>

        <h2 className={heading}>Questions</h2>
        <p className={body}>
          Email{" "}
          <a href={`mailto:${brand.email}`} className="text-gold hover:text-gold-soft">
            {brand.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
