import { refundPolicy } from "@/data/refund-policy";

export function RefundPolicyBody() {
  return (
    <div className="space-y-4 text-[0.95rem] leading-relaxed text-ivory/80">
      <p className="font-semibold text-ivory">{refundPolicy.final}</p>
      <p>{refundPolicy.purchased}</p>
      <p>{refundPolicy.cancelled}</p>
      <div>
        <p>{refundPolicy.notRefundedIntro}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {refundPolicy.notRefunded.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>{refundPolicy.postponed}</p>
      <p>{refundPolicy.law}</p>
    </div>
  );
}
