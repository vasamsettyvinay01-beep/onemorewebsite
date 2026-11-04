"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { Chip, Empty, ErrorNote, inputClass, Pager, quietButton, Stat, toneFor } from "./ui";

const MAX_TICKETS = 10;

interface ComplimentaryEntry {
  ref: string;
  name: string | null;
  email: string;
  issued: number;
  used: number;
  remaining: number;
  status: string;
  emailStatus: string;
  createdAt: string;
  issuedBy: string | null;
}

interface ComplimentaryList {
  entries: ComplimentaryEntry[];
  issued: number;
  admitted: number;
  remaining: number;
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
  const [phone, setPhone] = useState("");
  const [ticketCount, setTicketCount] = useState(1);
  const [idempotencyKey, setIdempotencyKey] = useState(newRequestKey);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; body: ComplimentaryList | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${eventId}|${page}|${nonce}`;

  function edit(update: () => void) {
    update();
    setPreview(null);
  }

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

  async function showPreview() {
    if (!eventId) return;
    setPreviewing(true);
    setError(null);
    try {
      const body = await adminCall<{ html: string }>("complimentary_preview", { eventId, name, ticketCount });
      setPreview(body.html);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "The preview could not be opened.");
    } finally {
      setPreviewing(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !preview) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<SendResult>("issue_complimentary", {
        eventId,
        name,
        email,
        phone,
        ticketCount,
        idempotencyKey,
      });
      setMessage(body.message);
      if (!body.ok) setError("The tickets exist, but delivery still needs attention.");
      setName("");
      setEmail("");
      setPhone("");
      setTicketCount(1);
      setPreview(null);
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
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold tracking-tight">Complimentary tickets</h1>
      <p className="mt-1 text-sm text-white/55">
        Each ticket admits one guest and has its own QR. Complimentary admissions stay out of public ticket types, checkout, and revenue.
      </p>

      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

      <form onSubmit={send} className="mt-4 rounded-lg border border-white/10 bg-[#171916] p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-white/55">
            Recipient name
            <input className={`${inputClass} mt-1`} value={name} onChange={(e) => edit(() => setName(e.target.value))} maxLength={80} autoComplete="name" required />
          </label>
          <label className="text-xs text-white/55">
            Email
            <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(e) => edit(() => setEmail(e.target.value))} maxLength={320} autoComplete="email" required />
          </label>
          <label className="text-xs text-white/55">
            Phone <span className="text-white/35">optional</span>
            <input className={`${inputClass} mt-1`} value={phone} onChange={(e) => edit(() => setPhone(e.target.value))} maxLength={40} autoComplete="tel" />
          </label>
          <div className="text-xs text-white/55">
            Number of tickets
            <div className="mt-1 flex h-9 items-center gap-2">
              <button type="button" className={quietButton} onClick={() => edit(() => setTicketCount((count) => Math.max(1, count - 1)))} disabled={ticketCount <= 1} aria-label="Fewer tickets">−</button>
              <span className="w-8 text-center text-sm font-semibold text-white">{ticketCount}</span>
              <button type="button" className={quietButton} onClick={() => edit(() => setTicketCount((count) => Math.min(MAX_TICKETS, count + 1)))} disabled={ticketCount >= MAX_TICKETS} aria-label="More tickets">+</button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={quietButton} disabled={previewing || name.trim().length < 2} onClick={() => void showPreview()}>
            {previewing ? "Opening preview…" : "Preview"}
          </button>
          <button
            className="h-9 rounded-md bg-[#eceae4] px-4 text-sm font-semibold text-[#141513] disabled:opacity-40"
            type="submit"
            disabled={busy || !preview}
          >
            {busy ? "Sending…" : `Send ${ticketCount} complimentary ticket${ticketCount === 1 ? "" : "s"}`}
          </button>
        </div>
        {preview && (
          <iframe title="Complimentary invitation preview" className="mt-3 h-[640px] w-full rounded-md border border-white/10 bg-black" sandbox="allow-same-origin" srcDoc={preview} />
        )}
      </form>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Complimentary issued" value={current?.body?.issued ?? "—"} hint="Not paid revenue" />
        <Stat label="Complimentary admitted" value={current?.body?.admitted ?? "—"} hint={event.name} />
        <Stat label="Complimentary remaining" value={current?.body?.remaining ?? "—"} hint="Still valid at the door" />
      </div>

      <h2 className="mt-6 text-sm font-semibold">Issuance history</h2>
      {!current && <p className="mt-2 text-sm text-white/50">Loading complimentary tickets…</p>}
      {current?.error && <div className="mt-2"><ErrorNote>{current.error}</ErrorNote></div>}
      {current?.body && current.body.entries.length === 0 && <Empty>No complimentary tickets have been issued for this event.</Empty>}
      {current?.body && current.body.entries.length > 0 && (
        <>
          <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Issued</th>
                  <th className="px-3 py-2 font-medium">Used</th>
                  <th className="px-3 py-2 font-medium">Remaining</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Issued at</th>
                  <th className="px-3 py-2 font-medium">Issued by</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {current.body.entries.map((entry) => (
                  <tr key={entry.ref}>
                    <td className="px-3 py-2 font-medium">{entry.name || "Guest"}</td>
                    <td className="px-3 py-2 text-white/70">{entry.email}</td>
                    <td className="px-3 py-2">{entry.issued}</td>
                    <td className="px-3 py-2">{entry.used}</td>
                    <td className="px-3 py-2">{entry.remaining}</td>
                    <td className="px-3 py-2"><Chip tone={toneFor(entry.status)}>{entry.status}</Chip></td>
                    <td className="px-3 py-2 text-white/55">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-white/55">{entry.issuedBy ?? "—"}</td>
                    <td className="px-3 py-2">
                      {entry.emailStatus === "Not sent" && (
                        <button type="button" className={quietButton} disabled={retrying !== null} onClick={() => void retry(entry)}>
                          {retrying === entry.ref ? "Sending…" : "Retry email"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={current.body.page} pageSize={current.body.pageSize} total={current.body.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
