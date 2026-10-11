/** Normalises a guest-supplied display name without turning it into an identity check. */
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return null;
  if (!/^[\p{L}][\p{L}\p{M}\s'’.-]*[\p{L}\p{M}.]$/u.test(name)) return null;
  return properName(name);
}

/** Title-cases names entered entirely in lower- or upper-case and preserves intentional mixed case. */
export function properName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const value = name.normalize("NFC").trim().replace(/\s+/g, " ");
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}
