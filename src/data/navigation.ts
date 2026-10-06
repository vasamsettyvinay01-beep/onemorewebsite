/**
 * Anchor ids for the few moments that can be reached directly.
 * The page is one continuous canvas — these are landmarks, not sections.
 */
export const anchors = {
  arrival: "arrival",
  company: "company",
  experience: "experience",
  campaign: "launch-series",
  gathering: "gathering",
  closing: "closing",
} as const;

export type MenuAction = { label: string; kind: "anchor"; target: string } | { label: string; kind: "community" };

/** Desktop header — intentionally tiny. */
export const headerMenu: MenuAction[] = [
  { label: "EVENTS", kind: "anchor", target: anchors.experience },
  { label: "COMMUNITY", kind: "community" },
];
