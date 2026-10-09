"use client";

import { useEffect, useState } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { when } from "./format";
import type { AuditEntry } from "./types";
import { Empty, ErrorNote, Pager } from "./ui";

export function AuditPanel() {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    adminCall<{ entries: AuditEntry[]; total: number }>("audit", { page, pageSize: 25 })
      .then((body) => {
        if (cancel) return;
        setRows(body.entries);
        setTotal(body.total);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof AdminApiError ? err.message : "Could not load the audit log.");
      });
    return () => {
      cancel = true;
    };
  }, [page]);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-white/50">Append-only. Credentials and pass secrets are not shown.</p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-4 space-y-2 md:hidden">
        {rows.map((entry) => (
          <article key={`${entry.at}-${entry.action}-${entry.resourceRef}`} className="rounded-lg border border-white/10 bg-[#171916] p-3 text-sm">
            <p className="text-white/50">{when(entry.at)}</p>
            <p className="mt-1 font-medium">{entry.action}</p>
            <p className="text-white/70">{entry.actor}{entry.role ? ` · ${entry.role}` : ""}</p>
            <p className="text-white/50">{[entry.resource, entry.resourceRef].filter(Boolean).join(" ")}</p>
            <Summary summary={entry.summary} />
          </article>
        ))}
      </div>
      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
            <tr>
              {["Time", "Actor", "Role", "Action", "Resource", "Details"].map((label) => (
                <th key={label} className="py-2 pr-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={`${entry.at}-${entry.action}-${entry.resourceRef}`} className="border-t border-white/10 align-top">
                <td className="py-2 pr-3 text-white/70">{when(entry.at)}</td>
                <td className="py-2 pr-3">{entry.actor}</td>
                <td className="py-2 pr-3 text-white/60">{entry.role ?? "—"}</td>
                <td className="py-2 pr-3">{entry.action}</td>
                <td className="py-2 pr-3">{entry.resourceRef ?? entry.resource ?? "—"}</td>
                <td className="py-2 pr-3"><Summary summary={entry.summary} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !error && <Empty>No audit entries yet.</Empty>}
      <Pager page={page} pageSize={25} total={total} onPage={setPage} />
    </div>
  );
}

function Summary({ summary }: { summary: AuditEntry["summary"] }) {
  const entries = Object.entries(summary);
  if (!entries.length) return <span className="text-white/35">—</span>;
  return <span className="text-white/60">{entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</span>;
}
