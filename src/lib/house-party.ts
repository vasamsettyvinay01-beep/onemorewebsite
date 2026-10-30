import { functionUrl } from "@/data/backend";

export type HousePartyState = "active" | "full" | "ended";

export interface HousePartyStatus {
  state: HousePartyState;
  capacity: number;
  confirmedPeople: number;
  rsvpGroups: number;
  spotsRemaining: number;
}

export interface HousePartySuccess {
  status: "confirmed";
  partySize: number;
  spotsRemaining: number;
}

export interface HousePartyFailure {
  status: "duplicate" | "insufficient_capacity" | "full" | "ended" | "invalid";
  error: string;
  spotsRemaining?: number;
  existingPartySize?: number;
}

export async function getHousePartyStatus(signal?: AbortSignal): Promise<HousePartyStatus> {
  const response = await fetch(functionUrl("house-party"), { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load RSVP availability.");
  return response.json() as Promise<HousePartyStatus>;
}

export async function submitHousePartyRsvp(input: {
  fullName: string;
  email: string;
  phone: string;
  instagram: string;
  partySize: number;
  guestNames: string[];
  ageConfirmed: boolean;
}): Promise<HousePartySuccess | HousePartyFailure> {
  const response = await fetch(functionUrl("house-party"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as HousePartySuccess | HousePartyFailure;
  if (response.ok && body.status === "confirmed") return body;
  return {
    status: "status" in body && typeof body.status === "string" ? body.status as HousePartyFailure["status"] : "invalid",
    error: "error" in body && typeof body.error === "string" ? body.error : "Please check your RSVP details.",
    spotsRemaining: "spotsRemaining" in body && typeof body.spotsRemaining === "number" ? body.spotsRemaining : undefined,
    existingPartySize: "existingPartySize" in body && typeof body.existingPartySize === "number" ? body.existingPartySize : undefined,
  };
}

export function spotsLabel(spots: number): string {
  if (spots <= 5) return `ONLY ${spots} SPOT${spots === 1 ? "" : "S"} LEFT`;
  return `${spots} SPOTS LEFT`;
}
