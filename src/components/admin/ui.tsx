import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "info" | "neutral" }) {
  const tones = {
    good: "bg-emerald-400/15 text-emerald-100",
    warn: "bg-amber-300/15 text-amber-100",
    bad: "bg-rose-400/15 text-rose-100",
    info: "bg-sky-400/15 text-sky-100",
    neutral: "bg-white/10 text-white/70",
  };
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide", tones[tone])}>{children}</span>;
}

export function toneFor(status: string): "good" | "warn" | "bad" | "info" | "neutral" {
  const value = status.toLowerCase();
  if (value === "checked in" || value === "already used") return "info";
  if (["paid", "valid", "sent", "on sale", "open", "none"].includes(value)) return "good";
  if (["refunded", "partial", "not sent", "sales paused", "paused"].includes(value)) return "warn";
  if (["cancelled", "disputed", "invalid", "sold out", "closed"].includes(value)) return "bad";
  return "neutral";
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#171916] px-3 py-3">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/45">{hint}</p>}
    </div>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#171916]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-white/50">{children}</p>;
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
      <span>{total === 0 ? "No results" : `${start}–${end} of ${total}`}</span>
      <div className="flex gap-2">
        <button type="button" className="rounded border border-white/15 px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="self-center tabular-nums">
          {page} / {pages}
        </span>
        <button type="button" className="rounded border border-white/15 px-2 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{children}</p>;
}

export const inputClass =
  "h-9 w-full min-w-0 rounded-md border border-white/15 bg-black/30 px-2.5 text-sm text-[#eceae4] outline-none focus:border-white/40";

export const quietButton = "h-9 shrink-0 rounded-md border border-white/15 px-3 text-sm hover:bg-white/5";
