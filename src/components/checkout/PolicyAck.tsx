"use client";

import { useState } from "react";
import { refundPolicy } from "@/data/refund-policy";
import { RefundPolicyBody } from "@/components/policy/RefundPolicyBody";
import { Dialog } from "@/components/ui/Dialog";

export function PolicyAck({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
  const [open, setOpen] = useState<"terms" | "refunds" | null>(null);

  return (
    <div className="mt-3">
      <label className="flex items-start gap-2.5 text-left text-[0.72rem] leading-snug text-ivory/70">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#BB9B63]"
        />
        <span>{refundPolicy.checkbox}</span>
      </label>
      <p className="mt-2 text-center text-[0.68rem] text-ivory/50">
        By purchasing, you agree to our{" "}
        <button type="button" onClick={() => setOpen("terms")} className="text-gold/90 underline-offset-2 hover:underline">
          Terms
        </button>{" "}
        and{" "}
        <button type="button" onClick={() => setOpen("refunds")} className="text-gold/90 underline-offset-2 hover:underline">
          Refund Policy
        </button>
        .
      </p>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={refundPolicy.title} variant="sheet">
        {open === "terms" && (
          <p className="mb-4 text-[0.95rem] leading-relaxed text-ivory/80">
            By purchasing a ticket you agree to this Refund &amp; Cancellation Policy and to the event&apos;s age, identification, and venue rules.
          </p>
        )}
        <RefundPolicyBody />
        <p className="mt-4 text-[0.8rem]">
          <a href="/refunds/" className="text-gold underline-offset-2 hover:underline">
            Open the policy page
          </a>
        </p>
      </Dialog>
    </div>
  );
}
