/** Customer-facing refund policy. Checkout, email, and /refunds all render this copy. */
export const refundPolicy = {
  title: "Refund & cancellation policy",
  final: "All ticket sales are final.",
  purchased:
    "Tickets purchased for The One More Company events are non-refundable and non-returnable unless the event is cancelled by The One More Company.",
  cancelled:
    "If an event is cancelled by The One More Company, eligible ticket holders will receive a refund to the original payment method, subject to payment processor timelines.",
  notRefundedIntro: "Tickets will not be refunded for:",
  notRefunded: [
    "change of plans",
    "inability to attend",
    "late arrival",
    "failure to meet age or ID requirements",
    "removal from the venue for violating venue or event rules",
    "lost access to a ticket caused by customer error",
    "weather or transportation issues unless the event itself is officially cancelled",
  ],
  postponed:
    "If an event is postponed, rescheduled, moved, or materially changed, follow the policy configured for that event and applicable law.",
  law: "All refund decisions remain subject to applicable consumer-protection laws and payment-provider requirements.",
  emailLine: "All sales are final. Refunds are provided only if the event is cancelled, subject to applicable law.",
  checkbox: "I understand that ticket sales are final and non-refundable unless the event is cancelled.",
  purchaseLine: "By purchasing, you agree to our Terms and Refund Policy.",
  shareWarning:
    "Sharing this ticket gives the recipient access to this admission. Each ticket can be checked in only once.",
} as const;
