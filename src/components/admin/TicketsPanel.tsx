"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { when } from "./format";
import type { TicketRecord } from "./types";
import { Chip, Empty, ErrorNote, Pager, inputClass, quietButton, toneFor } from "./ui";

export function TicketsPanel() {
  const { eventId, event } = useAdmin();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [tierId, setTierId] = useState("");
  const [status, setStatus] = useState("");
  const [checkedIn, setCheckedIn] = useState("");
  const [page, setPage] = useState(1);
  const [pageEvent, setPageEvent] = useState(eventId);
  const [loaded, setLoaded] = useState<{ key: string; rows: TicketRecord[]; total: number; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  if (pageEvent !== eventId) {
    setPageEvent(eventId);
    setPage(1);
  }
  const requestKey = [eventId, q, tierId, status, checkedIn, page, nonce].join("|");

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<{ tickets: TicketRecord[]; total: number }>("tickets", { eventId, q, tierId, status, checkedIn, page, pageSize: 25 })
      .then((body) => {
        if (!cancel) setLoaded({ key: requestKey, rows: body.tickets, total: body.total, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ key: requestKey, rows: [], total: 0, error: err instanceof AdminApiError ? err.message : "Could not load passes." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, q, tierId, status, checkedIn, page, nonce, requestKey]);

  function search(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQ(draft.trim());
    setNonce((value) => value + 1);
  }

  const current = loaded?.key === requestKey ? loaded : null;
  const rows = current?.rows ?? [];
  const total = current?.total ?? 0;
  const error = current?.error ?? null;
  const loading = Boolean(eventId) && !current;

  if (!eventId) return <Empty>Choose an event.</Empty>;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Passes</h1>
      <p className="mt-1 text-sm text-white/50">Search by the short pass reference, such as T-1A2B3C4D.</p>
      <form onSubmit={search} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="T- reference" aria-label="Pass reference" />
        <select className={inputClass} value={tierId} onChange={(e) => { setTierId(e.target.value); setPage(1); }} aria-label="Tier">
          <option value="">All tiers</option>
          {(event?.tiers ?? []).map((tier) => (
            <option key={tier.id} value={tier.id}>{tier.name}</option>
          ))}
        </select>
        <select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Pass status">
          <option value="">Any status</option>
          <option value="valid">Valid</option>
          <option value="checked-in">Checked in</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
        <select className={inputClass} value={checkedIn} onChange={(e) => { setCheckedIn(e.target.value); setPage(1); }} aria-label="Check-in state">
          <option value="">Any check-in</option>
          <option value="checked-in">Checked in</option>
          <option value="not-checked-in">Not checked in</option>
        </select>
        <button className={quietButton} type="submit">Search</button>
      </form>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {loading && <p className="mt-3 text-sm text-white/45">Loading passes…</p>}
      {!loading && rows.length === 0 && <Empty>No passes match these filters.</Empty>}
      <div className="mt-3 space-y-2 md:hidden">
        {rows.map((ticket) => (
          <article key={ticket.ref} className="rounded-lg border border-white/10 bg-[#171916] p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{ticket.ref}</span>
              <Chip tone={toneFor(ticket.status)}>{ticket.status}</Chip>
            </div>
            <p className="mt-1 text-white/70">{ticket.tier} · guest {ticket.guestNumber}</p>
            <p className="mt-1 text-white/50">{ticket.checkedIn ? `Checked in ${when(ticket.checkedInAt)}` : "Not checked in"}</p>
            <Link className="mt-2 inline-block text-white/70 underline decoration-white/20" href={`/admin/orders?ref=${ticket.orderRef}`}>{ticket.orderRef}</Link>
          </article>
        ))}
      </div>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
            <tr>
              {["Pass", "Tier", "Guest", "Status", "Check-in", "Time", "Order"].map((label) => (
                <th key={label} className="py-2 pr-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ticket) => (
              <tr key={ticket.ref} className="border-t border-white/10">
                <td className="py-2 pr-3">{ticket.ref}</td>
                <td className="py-2 pr-3">{ticket.tier}</td>
                <td className="py-2 pr-3 tabular-nums">{ticket.guestNumber}</td>
                <td className="py-2 pr-3"><Chip tone={toneFor(ticket.status)}>{ticket.status}</Chip></td>
                <td className="py-2 pr-3">{ticket.checkedIn ? "Checked in" : "Not checked in"}</td>
                <td className="py-2 pr-3 text-white/60">{when(ticket.checkedInAt)}</td>
                <td className="py-2 pr-3"><Link className="underline decoration-white/20" href={`/admin/orders?ref=${ticket.orderRef}`}>{ticket.orderRef}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={25} total={total} onPage={setPage} />
    </div>
  );
}
