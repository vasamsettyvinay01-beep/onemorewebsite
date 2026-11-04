import { functionUrl } from "@/data/backend";

export { partnerBox } from "./partner-box";

export interface VipEvent {
  title: string;
  date: string;
  shortDate: string;
  time: string;
  venue: string;
  city: string;
  address: string;
  mapUrl: string;
  minAge: number | null;
}

export interface VipPartner {
  name: string;
  /** Storage key under brand/, mirrored at /brand/<key> on this site. */
  logo: string;
  width: number;
  height: number;
}

export interface VipPass {
  status: "issued" | "partial" | "complete";
  table: string;
  host: string;
  capacity: number;
  admitted: number;
  remaining: number;
  code: string;
  event: VipEvent | null;
  partners: VipPartner[];
}

export type VipPassResult = VipPass | { status: "inactive" };

export const VIP_TOKEN_RE = /^vip_[0-9a-f]{48}$/;

/** POST keeps the credential out of URLs and request logs. */
export async function fetchVipPass(token: string): Promise<VipPassResult | null> {
  const response = await fetch(functionUrl("vip-pass"), {
    method: "POST",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("vip_pass_unavailable");
  return response.json() as Promise<VipPassResult>;
}

export function partnerLogoSrc(logo: string): string {
  return `/brand/${logo.replace(/^\/+/, "")}`;
}

/** Matches the invitation email: "1 Guest", "Up to 6 Guests". */
export function accessLabel(capacity: number): string {
  return capacity === 1 ? "1 Guest" : `Up to ${capacity} Guests`;
}

export function guestsLabel(count: number): string {
  return `${count} ${count === 1 ? "Guest" : "Guests"}`;
}
