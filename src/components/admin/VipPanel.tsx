"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { Chip, Empty, ErrorNote, inputClass, quietButton, Stat } from "./ui";
import { cn } from "@/lib/cn";
import { guestsLabel, type VipPass } from "@/lib/vip";
import { VipCredential } from "@/components/vip/VipCredential";

const CAPACITIES = [1, 2, 3, 4, 5, 6] as const;

interface VipEntry {
  code: string;
  table: string;
  host: string;
  email: string;
  capacity: number;
  admitted: number;
  remaining: number;
  status: string;
  statusLabel: string;
  issuedAt: string;
  lastEntryAt: string | null;
  emailStatus: string;
  emailCount: number;
}

interface VipList {
  summary: { groups: number; allocated: number; admitted: number; remaining: number; revoked: number; cancelled: number };
  invitations: VipEntry[];
}

interface VipDetail {
  invitation: VipEntry & {
    phone: string | null;
    note: string | null;
    issuedBy: string | null;
    revokedAt: string | null;
    revokedBy: string | null;
    passUrl: string;
  };
  admissions: { guests: number; admittedAfter: number; operator: string; device: string | null; at: string }[];
}

interface Preview {
  key: string;
  subject: string;
  html: string;
  pass: VipPass;
}

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "neutral"> = {
  issued: "good",
  partially_admitted: "info",
  fully_admitted: "neutral",
  revoked: "bad",
  cancelled: "bad",
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export function VipPanel() {
  const { role, eventId } = useAdmin();
  if (role !== "super_admin") {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">VIP invitations</h1>
        <p className="mt-2 text-sm text-white/60">Only a super admin can issue or view VIP invitations.</p>
      </div>
    );
  }
  return <VipDesk key={eventId} />;
}

function VipDesk() {
  const { eventId, event } = useAdmin();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [table, setTable] = useState("");
  const [capacity, setCapacity] = useState<number>(6);
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewWidth, setPreviewWidth] = useState<"mobile" | "desktop">("mobile");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [list, setList] = useState<{ nonce: number; body: VipList | null; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<VipDetail | null>(null);
  const [revoking, setRevoking] = useState<VipEntry | null>(null);

  const inputKey = JSON.stringify([eventId, name.trim(), email.trim().toLowerCase(), phone.trim(), table.trim(), capacity, note.trim()]);
  const livePreview = preview?.key === inputKey ? preview : null;

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<VipList>("vip_list", { eventId })
      .then((body) => {
        if (!cancel) setList({ nonce, body, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setList({ nonce, body: null, error: err instanceof AdminApiError ? err.message : "Could not load VIP invitations." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, nonce]);

  const details = { eventId, name, email, phone, table, capacity, note };

  async function runPreview(e: FormEvent) {
    e.preventDefault();
    setBusy("preview");
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<Omit<Preview, "key">>("vip_preview", details);
      setPreview({ ...body, key: inputKey });
    } catch (err) {
      setPreview(null);
      setError(err instanceof AdminApiError ? err.message : "The preview could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!livePreview) return;
    setBusy("send");
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<{ ok: boolean; message: string }>("vip_issue", { ...details, idempotencyKey });
      setMessage(body.message);
      if (!body.ok) setError("The invitation exists, but the email still needs to be sent.");
      setName("");
      setEmail("");
      setPhone("");
      setTable("");
      setCapacity(6);
      setNote("");
      setPreview(null);
      setIdempotencyKey(crypto.randomUUID());
      setNonce((value) => value + 1);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "The VIP invitation could not be sent.");
    } finally {
      setBusy(null);
    }
  }

  async function view(entry: VipEntry) {
    setRowBusy(entry.code);
    setError(null);
    try {
      setViewing(await adminCall<VipDetail>("vip_view", { eventId, code: entry.code }));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not open that invitation.");
    } finally {
      setRowBusy(null);
    }
  }

  async function resend(entry: VipEntry) {
    setRowBusy(entry.code);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<{ ok: boolean; message: string }>("vip_resend", { eventId, code: entry.code });
      if (body.ok) setMessage(body.message);
      else setError(body.message);
      setNonce((value) => value + 1);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "The invitation could not be resent.");
    } finally {
      setRowBusy(null);
    }
  }

  const current = list?.nonce === nonce ? list : null;
  if (!eventId || !event) return <Empty>Choose an event.</Empty>;

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold tracking-tight">VIP invitations</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/55">
        Private table access for up to six guests on one credential. Invitations are never sold, never shown publicly, and do not touch ticket
        inventory, checkout, or revenue.
      </p>

      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="VIP groups issued" value={current?.body?.summary.groups ?? "—"} />
        <Stat label="Total VIP allocated" value={current?.body?.summary.allocated ?? "—"} hint="Max 6 per group" />
        <Stat label="VIP guests admitted" value={current?.body?.summary.admitted ?? "—"} />
        <Stat label="VIP guests remaining" value={current?.body?.summary.remaining ?? "—"} />
        <Stat label="Revoked" value={current?.body?.summary.revoked ?? "—"} />
      </div>

      <form onSubmit={runPreview} className="mt-6 rounded-lg border border-white/10 bg-[#171916] p-3">
        <h2 className="text-sm font-semibold">Create VIP invitation</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-white/55">
            Primary guest name
            <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" required />
          </label>
          <label className="text-xs text-white/55">
            Email
            <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} autoComplete="off" required />
          </label>
          <label className="text-xs text-white/55">
            Phone <span className="text-white/35">(optional)</span>
            <input className={`${inputClass} mt-1`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="off" />
          </label>
          <label className="text-xs text-white/55">
            VIP table / group label
            <input
              className={`${inputClass} mt-1`}
              value={table}
              onChange={(e) => setTable(e.target.value)}
              maxLength={40}
              placeholder="VIP TABLE 01"
              autoComplete="off"
              required
            />
          </label>
          <label className="text-xs text-white/55">
            Access
            <select className={`${inputClass} mt-1`} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} required>
              {CAPACITIES.map((count) => (
                <option key={count} value={count}>{guestsLabel(count)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/55">
            Admin note <span className="text-white/35">(never shown to the guest)</span>
            <input
              className={`${inputClass} mt-1`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Founder guest"
              autoComplete="off"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="h-9 rounded-md bg-[#eceae4] px-4 text-sm font-semibold text-[#141513] disabled:opacity-40" type="submit" disabled={busy !== null}>
            {busy === "preview" ? "Preparing preview…" : livePreview ? "Refresh preview" : "Preview invitation"}
          </button>
          {preview && !livePreview && <span className="self-center text-xs text-amber-200/80">Details changed. Preview again before sending.</span>}
        </div>
      </form>

      {livePreview && (
        <section className="mt-4 rounded-lg border border-[#C6A15B]/30 bg-[#121311] p-3" aria-label="Invitation preview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[#C6A15B]">Preview invitation</p>
              <p className="mt-0.5 truncate text-sm">Subject: {livePreview.subject}</p>
              <p className="text-xs text-white/45">To {email.trim().toLowerCase()} · the QR here is a sample and will not scan as valid.</p>
            </div>
            <div className="flex gap-1 rounded-md border border-white/15 p-0.5 text-xs">
              {(["mobile", "desktop"] as const).map((width) => (
                <button
                  key={width}
                  type="button"
                  onClick={() => setPreviewWidth(width)}
                  className={cn("rounded px-2.5 py-1 capitalize", previewWidth === width ? "bg-white/10 text-white" : "text-white/55")}
                >
                  {width}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#0B0B0C]">
              <EmailFrame html={livePreview.html} width={previewWidth === "mobile" ? 375 : 640} />
            </div>
            <div className="rounded-md border border-white/10 bg-[#0F0F10] px-4 py-8">
              <VipCredential pass={livePreview.pass} qrValue="PREVIEW-NOT-VALID-FOR-ENTRY" preview />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="h-10 rounded-md bg-[#C6A15B] px-5 text-sm font-semibold text-[#0F0F10] disabled:opacity-40"
              disabled={busy !== null}
              onClick={() => void send()}
            >
              {busy === "send" ? "Sending…" : "Send VIP invitation"}
            </button>
            <button type="button" className={quietButton} disabled={busy !== null} onClick={() => setPreview(null)}>
              Edit details
            </button>
          </div>
        </section>
      )}

      <h2 className="mt-8 text-sm font-semibold">Issued invitations</h2>
      {!current && <p className="mt-2 text-sm text-white/50">Loading VIP invitations…</p>}
      {current?.error && <div className="mt-2"><ErrorNote>{current.error}</ErrorNote></div>}
      {current?.body && current.body.invitations.length === 0 && <Empty>No VIP invitations have been issued for this event.</Empty>}
      {current?.body && current.body.invitations.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-white/45">
              <tr className="border-b border-white/10">
                {["Table", "Host", "Email", "Access", "Admitted", "Remaining", "Status", "Issued", "Last entry", ""].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {current.body.invitations.map((entry) => {
                const live = entry.status === "issued" || entry.status === "partially_admitted";
                return (
                  <tr key={entry.code}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{entry.table}</span>
                      <span className="block text-xs text-white/40">{entry.code}</span>
                    </td>
                    <td className="px-3 py-2.5">{entry.host}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2.5 text-white/70">
                      {entry.email}
                      {entry.emailStatus === "Not sent" && <span className="ml-2"><Chip tone="warn">Not sent</Chip></span>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{entry.capacity}</td>
                    <td className="px-3 py-2.5 tabular-nums">{entry.admitted}</td>
                    <td className="px-3 py-2.5 tabular-nums">{entry.remaining}</td>
                    <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[entry.status] ?? "neutral"}>{entry.statusLabel}</Chip></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-white/60">{when(entry.issuedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-white/60">{when(entry.lastEntryAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className={quietButton} disabled={rowBusy !== null} onClick={() => void view(entry)}>View</button>
                        {entry.status !== "revoked" && entry.status !== "cancelled" && (
                          <button type="button" className={quietButton} disabled={rowBusy !== null} onClick={() => void resend(entry)}>
                            {rowBusy === entry.code ? "Sending…" : "Resend"}
                          </button>
                        )}
                        {live && (
                          <button type="button" className={cn(quietButton, "border-rose-400/30 text-rose-100")} disabled={rowBusy !== null} onClick={() => setRevoking(entry)}>
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <VipDetailSheet detail={viewing} onClose={() => setViewing(null)} />}
      {revoking && (
        <RevokeSheet
          entry={revoking}
          eventId={eventId}
          onClose={() => setRevoking(null)}
          onDone={(text) => {
            setRevoking(null);
            setMessage(text);
            setNonce((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}

/** Same-origin sandbox without scripts, so the page CSP covers the email's images. */
function EmailFrame({ html, width }: { html: string; width: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1400);
  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(600, doc.documentElement.scrollHeight));
  }, []);
  return (
    <iframe
      ref={ref}
      title="VIP invitation email preview"
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={measure}
      className="mx-auto block bg-[#0B0B0C]"
      style={{ width, height, border: 0 }}
    />
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/15 bg-[#171916] p-4 text-[#eceae4]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="text-sm text-white/55" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function VipDetailSheet({ detail, onClose }: { detail: VipDetail; onClose: () => void }) {
  const v = detail.invitation;
  const rows: [string, string][] = [
    ["Credential", v.code],
    ["Host", v.host],
    ["Email", v.email],
    ["Phone", v.phone || "—"],
    ["Access", guestsLabel(v.capacity)],
    ["Admitted", `${v.admitted} of ${v.capacity}`],
    ["Remaining", String(v.remaining)],
    ["Status", v.statusLabel],
    ["Email", `${v.emailStatus}${v.emailCount > 1 ? ` · sent ${v.emailCount} times` : ""}`],
    ["Issued", `${when(v.issuedAt)}${v.issuedBy ? ` by ${v.issuedBy}` : ""}`],
    ["Last entry", when(v.lastEntryAt)],
    ...(v.revokedAt ? ([["Revoked", `${when(v.revokedAt)}${v.revokedBy ? ` by ${v.revokedBy}` : ""}`]] as [string, string][]) : []),
    ["Admin note", v.note || "—"],
  ];
  return (
    <Sheet title={v.table} onClose={onClose}>
      <dl className="mt-3 divide-y divide-white/10 text-sm">
        {rows.map(([label, value], i) => (
          <div key={`${label}-${i}`} className="flex justify-between gap-4 py-1.5">
            <dt className="text-white/50">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Admissions</h3>
      {detail.admissions.length === 0 ? (
        <p className="mt-1 text-sm text-white/50">No one has been admitted yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-white/10 text-sm">
          {detail.admissions.map((entry) => (
            <li key={entry.at} className="flex justify-between gap-3 py-1.5">
              <span>
                +{entry.guests} <span className="text-white/45">→ {entry.admittedAfter} in</span>
              </span>
              <span className="text-right text-white/60">
                {when(entry.at)} · {entry.operator.split("@")[0]}
                {entry.device ? ` · ${entry.device}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {v.status !== "revoked" && v.status !== "cancelled" && (
        <a href={v.passUrl} target="_blank" rel="noopener noreferrer" className={cn(quietButton, "mt-4 inline-flex items-center")}>
          Open guest pass
        </a>
      )}
    </Sheet>
  );
}

function RevokeSheet({ entry, eventId, onClose, onDone }: { entry: VipEntry; eventId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function revoke(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await adminCall<{ message: string }>("vip_revoke", { eventId, code: entry.code, confirm });
      onDone(body.message);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "The invitation could not be revoked.");
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Revoke ${entry.table}`} onClose={onClose}>
      <form onSubmit={revoke}>
        <p className="mt-2 text-sm text-white/65">
          {entry.host}&apos;s pass will stop admitting guests immediately. {entry.admitted} of {entry.capacity} already admitted stay on record. The
          invitation is kept for history and cannot be reactivated.
        </p>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-3 flex gap-2">
          <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type REVOKE to confirm" aria-label="Type REVOKE to confirm" autoComplete="off" />
          <button type="submit" className="h-9 shrink-0 rounded-md bg-rose-500/80 px-4 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || confirm !== "REVOKE"}>
            {busy ? "Revoking…" : "Revoke pass"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
