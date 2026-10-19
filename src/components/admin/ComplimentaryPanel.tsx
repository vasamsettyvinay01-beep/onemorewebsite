"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { Chip, Empty, ErrorNote, inputClass, Pager, quietButton, Stat, toneFor } from "./ui";

interface ComplimentaryEntry {
  ref: string;
  name: string | null;
  email: string;
  tier: string;
  tierId: string;
  tickets: number;
  emailStatus: string;
  createdAt: string;
}

interface ComplimentaryList {
  entries: ComplimentaryEntry[];
  totalTickets: number;
  page: number;
  pageSize: number;
  total: number;
}

interface SendResult {
  ok: boolean;
  created: boolean;
  ref: string;
  emailStatus: string;
  message: string;
}

function newRequestKey() {
  return crypto.randomUUID();
}

export function ComplimentaryPanel() {
  const { role, eventId } = useAdmin();
  if (role !== "super_admin") {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">Complimentary tickets</h1>
        <p className="mt-2 text-sm text-white/60">Only a super admin can issue or view complimentary tickets.</p>
      </div>
    );
  }
  return <ComplimentaryDesk key={eventId} />;
}

function ComplimentaryDesk() {
  const { eventId, event } = useAdmin();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ticketCount, setTicketCount] = useState(1);
  const [tierId, setTierId] = useState(event?.tiers[0]?.id ?? "");
  const [confirm, setConfirm] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newRequestKey);
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; body: ComplimentaryList | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${eventId}|${page}|${nonce}`;

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<ComplimentaryList>("complimentary_list", { eventId, page, pageSize: 25 })
      .then((body) => {
        if (!cancel) setLoaded({ key: requestKey, body, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setLoaded({
            key: requestKey,
            body: null,
            error: err instanceof AdminApiError ? err.message : "Could not load complimentary tickets.",
          });
        }
      });
    return () => {
      cancel = true;
    };
  }, [eventId, page, requestKey]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !tierId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<SendResult>("issue_complimentary", {
        eventId,
        tierId,
        name,
        email,
        ticketCount,
        idempotencyKey,
        confirm,
      });
      setMessage(body.message);
      if (!body.ok) setError("The tickets exist, but delivery still needs attention.");
      setName("");
      setEmail("");
      setTicketCount(1);
      setConfirm("");
      setIdempotencyKey(newRequestKey());
      setPage(1);
      setNonce((value) => value + 1);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "Complimentary tickets could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(entry: ComplimentaryEntry) {
    if (!eventId) return;
    setRetrying(entry.ref);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<SendResult>("resend_complimentary", { eventId, ref: entry.ref });
      setMessage(body.message);
      if (!body.ok) setError("The email was not sent.");
      setNonce((value) => value + 1);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "The email could not be retried.");
    } finally {
      setRetrying(null);
    }
  }

  const current = loaded?.key === requestKey ? loaded : null;
  if (!eventId || !event) return <Empty>Choose an event.</Empty>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold tracking-tight">Complimentary tickets</h1>
      <p className="mt-1 text-sm text-white/55">
        Send individual QR tickets without a payment. These tickets do not affect public availability, sales, or revenue reporting.
      </p>

      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

      <form onSubmit={send} className="mt-4 rounded-lg border border-white/10 bg-[#171916] p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-white/55">
            Recipient name
            <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
          </label>
          <label className="text-xs text-white/55">
            Recipient email
            <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} autoComplete="email" required />
          </label>
          <label className="text-xs text-white/55">
            Ticket type
            <select className={`${inputClass} mt-1`} value={tierId} onChange={(e) => setTierId(e.target.value)} required>
              {event.tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>{tier.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/55">
            Number of unique QR tickets
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min={1}
              max={50}
              step={1}
              value={ticketCount}
              onChange={(e) => setTicketCount(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type SEND to confirm"
            aria-label="Type SEND to confirm"
            autoComplete="off"
          />
          <button
            className="h-9 shrink-0 rounded-md bg-[#eceae4] px-4 text-sm font-semibold text-[#141513] disabled:opacity-40"
            type="submit"
            disabled={busy || confirm !== "SEND" || !tierId || ticketCount < 1 || ticketCount > 50}
          >
            {busy ? "Creating and sending…" : `Send ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Complimentary tickets issued" value={current?.body?.totalTickets ?? "—"} hint="Super-admin-only count" />
        <Stat label="Recipients" value={current?.body?.total ?? "—"} hint={event.name} />
      </div>

      <h2 className="mt-6 text-sm font-semibold">Issuance history</h2>
      {!current && <p className="mt-2 text-sm text-white/50">Loading complimentary tickets…</p>}
      {current?.error && <div className="mt-2"><ErrorNote>{current.error}</ErrorNote></div>}
      {current?.body && current.body.entries.length === 0 && <Empty>No complimentary tickets have been issued for this event.</Empty>}
      {current?.body && current.body.entries.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-white/10 rounded-lg border border-white/10">
            {current.body.entries.map((entry) => (
              <li key={entry.ref} className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.name || "Guest"}</span>
                    <Chip tone={toneFor(entry.emailStatus)}>{entry.emailStatus}</Chip>
                  </span>
                  <span className="mt-0.5 block truncate text-white/55">{entry.email}</span>
                  <span className="mt-0.5 block text-xs text-white/40">
                    {entry.ref} · {entry.tier} · {entry.tickets} ticket{entry.tickets === 1 ? "" : "s"} · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </span>
                {entry.emailStatus === "Not sent" && (
                  <button type="button" className={quietButton} disabled={retrying !== null} onClick={() => void retry(entry)}>
                    {retrying === entry.ref ? "Sending…" : "Retry email"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Pager page={current.body.page} pageSize={current.body.pageSize} total={current.body.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
