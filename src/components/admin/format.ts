export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function count(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function when(iso: string | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

export function inRange(date: string, today: string, range: "today" | "7d" | "all"): boolean {
  if (range === "all") return true;
  if (range === "today") return date === today;
  return date >= shiftDay(today, -6) && date <= today;
}

export function roleLabel(role: string): string {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  return role;
}
