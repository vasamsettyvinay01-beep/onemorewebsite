"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { money } from "./format";
import type { OrderRecord } from "./types";
import { Empty, ErrorNote, inputClass, quietButton } from "./ui";

interface RefundPreview {
  ref: string;
  purchaser: string | null;
  email: string;
  tier: string;
  total: number;
  currency: string;
  passes: number;
  checkedIn: number;
  refundable: boolean;
  reason: string | null;
}

export function RefundsPanel() {
  const params = useSearchParams();
  const preset = params.get("ref") ?? "";
  return <RefundDesk preset={preset} />;
}

function RefundDesk({ preset }: { preset: string }) {
  const { eventId, event, role } = useAdmin();
  const [nonce, setNonce] = useState(0);
  const [rows, setRows] = useState<{ key: string; orders: OrderRecord[]; error: string | null } | null>(null);
  const [ref, setRef] = useState(preset);
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const adminLocked = role === "admin" && event?.salesStatus !== "cancelled" && event?.status !== "Cancelled";
  const requestKey = `${eventId}|paid|${nonce}`;

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<{ orders: OrderRecord[] }>("orders", { eventId, paymentStatus: "paid", page: 1, pageSize: 25 })
      .then((body) => {
        if (!cancel) setRows({ key: requestKey, orders: body.orders, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setRows({ key: requestKey, orders: [], error: err instanceof AdminApiError ? err.message : "Could not load orders." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, requestKey]);

  async function loadPreview(e: FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    try {
      const body = await adminCall<RefundPreview>("refund_preview", { eventId, ref: ref.trim() });
      setPreview(body);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "Could not open that order.");
    } finally {
      setBusy(false);
    }
  }

  async function refund(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !preview) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<{ ref: string }>("refund_one", { eventId, ref: preview.ref, confirm });
      setMessage(`${body.ref} was refunded. The card will show the return, and unused passes are cancelled.`);
      setPreview(null);
      setConfirm("");
      setNonce((value) => value + 1);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "The refund did not go through.");
    } finally {
      setBusy(false);
    }
  }

  const current = rows?.key === requestKey ? rows : null;
  if (!eventId) return <Empty>Choose an event.</Empty>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Refunds</h1>
      <p className="mt-1 text-sm text-white/55">
        A refund returns the full charge to the original card and cancels passes that have not been checked in.
        {adminLocked ? " An admin can do this only after the event is cancelled. A super admin can refund a paid order now." : " Type REFUND to confirm."}
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

      <form onSubmit={loadPreview} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="OMC- reference" aria-label="Order reference" />
        <button className={quietButton} type="submit" disabled={busy || !ref.trim()}>Look up</button>
      </form>

      {preview && (
        <form onSubmit={refund} className="mt-4 rounded-lg border border-white/10 bg-[#171916] p-3 text-sm">
          <p className="font-semibold">{preview.ref}</p>
          <p className="mt-1 text-white/70">{preview.purchaser || "Guest"} · {preview.email}</p>
          <p className="mt-1 text-white/70">{preview.tier} · {money(preview.total, preview.currency)} · {preview.passes} pass{preview.passes === 1 ? "" : "es"}</p>
          {preview.checkedIn > 0 && <p className="mt-2 text-amber-100">{preview.checkedIn} pass{preview.checkedIn === 1 ? " is" : "es are"} already checked in and will stay checked in.</p>}
          {preview.reason && <p className="mt-2 text-rose-100">{preview.reason}</p>}
          {preview.refundable && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type REFUND" aria-label="Type REFUND to confirm" autoComplete="off" />
              <button className="h-9 shrink-0 rounded-md bg-[#eceae4] px-3 text-sm font-semibold text-[#141513] disabled:opacity-40" type="submit" disabled={busy || confirm !== "REFUND"}>
                {busy ? "Refunding…" : "Refund card"}
              </button>
            </div>
          )}
        </form>
      )}

      <h2 className="mt-6 text-sm font-semibold">Paid orders</h2>
      {!current && <p className="mt-2 text-sm text-white/50">Loading orders…</p>}
      {current?.error && <div className="mt-2"><ErrorNote>{current.error}</ErrorNote></div>}
      {current && !current.error && current.orders.length === 0 && <Empty>No paid orders for this event.</Empty>}
      {current && current.orders.length > 0 && (
        <ul className="mt-2 divide-y divide-white/10 rounded-lg border border-white/10">
          {current.orders.map((order) => (
            <li key={order.ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{order.ref}</span>
                <span className="ml-2 text-white/60">{order.purchaser || "Guest"} · {money(order.total, order.currency)}</span>
              </span>
              <button type="button" className="text-white/70 underline-offset-2 hover:underline" onClick={() => { setRef(order.ref); setPreview(null); setConfirm(""); }}>
                Use this order
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
