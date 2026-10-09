"use client";

import { useEffect, useState } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { count, when } from "./format";
import type { CheckInReport } from "./types";
import { Chip, Empty, ErrorNote, Pager, Stat, toneFor } from "./ui";

export function CheckInPanel() {
  const { eventId } = useAdmin();
  const [page, setPage] = useState(1);
  const [pageEvent, setPageEvent] = useState(eventId);
  const [loaded, setLoaded] = useState<{ key: string; report: CheckInReport | null; error: string | null } | null>(null);
  if (pageEvent !== eventId) {
    setPageEvent(eventId);
    setPage(1);
  }
  const requestKey = `${eventId}|${page}`;

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<CheckInReport>("checkin", { eventId, page, pageSize: 25 })
      .then((body) => {
        if (!cancel) setLoaded({ key: requestKey, report: body, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ key: requestKey, report: null, error: err instanceof AdminApiError ? err.message : "Could not load check-in." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, page, requestKey]);

  const current = loaded?.key === requestKey ? loaded : null;
  if (!eventId) return <Empty>Choose an event.</Empty>;
  if (!current) return <p className="text-sm text-white/50">Loading check-in…</p>;
  if (current.error || !current.report) return <ErrorNote>{current.error ?? "Could not load check-in."}</ErrorNote>;
  const report = current.report;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Check-in</h1>
          <p className="mt-1 text-sm text-white/50">Counts come from the door log. Scanning stays on the door system.</p>
        </div>
        <a href="/door" target="_blank" rel="noopener noreferrer" className="rounded-md border border-white/15 px-3 py-2 text-sm">
          Scanner access — verify
        </a>
      </header>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Expected admissions" value={count(report.expected)} hint={report.cancelled > 0 ? `${count(report.cancelled)} cancelled` : undefined} />
        <Stat label="Checked in" value={count(report.checkedIn)} />
        <Stat label="Remaining" value={count(report.remaining)} />
        <Stat label="Check-in percentage" value={report.percent == null ? "—" : `${report.percent}%`} />
      </div>
      {report.expected === 0 && <p className="text-sm text-white/45">No admissions are currently expected.</p>}
      <section className="rounded-lg border border-white/10 bg-[#171916] p-3">
        <h2 className="text-sm font-semibold">Recent scans</h2>
        {report.scans.length === 0 ? (
          <Empty>No scans for this event.</Empty>
        ) : (
          <>
            <div className="mt-2 space-y-2 md:hidden">
              {report.scans.map((scan) => (
                <article key={`${scan.at}-${scan.ref ?? "invalid"}`} className="rounded-md border border-white/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>{scan.ref ?? "—"}</span>
                    <Chip tone={toneFor(scan.result)}>{scan.result}</Chip>
                  </div>
                  <p className="mt-1 text-white/55">{scan.tier ?? "No tier"} · {when(scan.at)}</p>
                </article>
              ))}
            </div>
            <div className="mt-2 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Pass</th>
                    <th className="py-2 pr-3 font-medium">Tier</th>
                    <th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.scans.map((scan) => (
                    <tr key={`${scan.at}-${scan.ref ?? "invalid"}`} className="border-t border-white/10">
                      <td className="py-2 pr-3 text-white/70">{when(scan.at)}</td>
                      <td className="py-2 pr-3">{scan.ref ?? "—"}</td>
                      <td className="py-2 pr-3">{scan.tier ?? "—"}</td>
                      <td className="py-2"><Chip tone={toneFor(scan.result)}>{scan.result}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Pager page={page} pageSize={25} total={report.total} onPage={setPage} />
      </section>
    </div>
  );
}
