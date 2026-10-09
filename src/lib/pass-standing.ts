export type PassStanding = "VALID" | "ALREADY USED" | "INVALID";

/** What a guest should see. A used pass stays used. A void or refunded pass is invalid. */
export function passStanding(
  ticketStatus: string | null | undefined,
  orderStatus: string | null | undefined,
): PassStanding {
  if (ticketStatus === "checked-in") return "ALREADY USED";
  if (ticketStatus === "cancelled" || orderStatus === "refunded") return "INVALID";
  return "VALID";
}
