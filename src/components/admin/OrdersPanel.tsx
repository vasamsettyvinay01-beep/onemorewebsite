"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { money, when } from "./format";
import type { OrderDetail, OrderRecord } from "./types";
import { Chip, Empty, ErrorNote, Pager, inputClass, quietButton, toneFor } from "./ui";

export function OrdersPanel() {
  const { eventId, event } = useAdmin();
  const params = useSearchParams();
  const ref = params.get("ref");
  if (ref) return <OrderDetailView eventId={eventId} refCode={ref} />;
  return <OrderTable eventId={eventId} eventName={event?.name ?? "Event"} tiers={event?.tiers ?? []} />;
}

function OrderTable({
  eventId,
  eventName,
  tiers,
}: {
  eventId: string;
  eventName: string;
  tiers: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [tierId, setTierId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageEvent, setPageEvent] = useState(eventId);
  const [loaded, setLoaded] = useState<{ key: string; rows: OrderRecord[]; total: number; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  if (pageEvent !== eventId) {
    setPageEvent(eventId);
    setPage(1);
  }
  const requestKey = [eventId, q, tierId, paymentStatus, refundStatus, from, to, page, nonce].join("|");

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<{ orders: OrderRecord[]; total: number }>("orders", {
      eventId,
      q,
      tierId,
      paymentStatus,
      refundStatus,
      from,
      to,
      page,
      pageSize: 25,
    })
      .then((body) => {
        if (!cancel) setLoaded({ key: requestKey, rows: body.orders, total: body.total, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ key: requestKey, rows: [], total: 0, error: err instanceof AdminApiError ? err.message : "Could not load orders." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, q, tierId, paymentStatus, refundStatus, from, to, page, nonce, requestKey]);

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
      <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
      <p className="mt-1 text-sm text-white/50">{eventName}. Search by name, email, or order reference. Dates are UTC.</p>
      <form onSubmit={search} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, email, or OMC- reference" aria-label="Search orders" />
        <select className={inputClass} value={tierId} onChange={(e) => { setTierId(e.target.value); setPage(1); }} aria-label="Tier">
          <option value="">All tiers</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>{tier.name}</option>
          ))}
        </select>
        <select className={inputClass} value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }} aria-label="Payment state">
          <option value="">Any payment</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
          <option value="partially-refunded">Partially refunded</option>
          <option value="disputed">Disputed</option>
        </select>
        <select className={inputClass} value={refundStatus} onChange={(e) => { setRefundStatus(e.target.value); setPage(1); }} aria-label="Refund state">
          <option value="">Any refund</option>
          <option value="none">None</option>
          <option value="refunded">Refunded</option>
          <option value="partial">Partial</option>
          <option value="disputed">Disputed</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
          <input className={inputClass} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
        </div>
        <button className={quietButton} type="submit">Search</button>
      </form>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {loading && <p className="mt-3 text-sm text-white/45">Loading orders…</p>}
      {!loading && rows.length === 0 && <Empty>No orders match these filters.</Empty>}
      <div className="mt-3 space-y-2 md:hidden">
        {rows.map((order) => (
          <Link key={order.ref} href={`/admin/orders?ref=${order.ref}`} className="block rounded-lg border border-white/10 bg-[#171916] p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{order.ref}</span>
              <Chip tone={toneFor(order.paymentStatus)}>{order.paymentStatus}</Chip>
            </div>
            <p className="mt-1">{order.purchaser || "Guest"}</p>
            <p className="truncate text-white/50">{order.email}</p>
            <p className="mt-2 text-white/70">{order.tier} · {order.units} units · {order.admissions} admissions</p>
            <p className="mt-1 tabular-nums">{money(order.total, order.currency)}</p>
          </Link>
        ))}
      </div>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[68rem] text-left text-sm">
          <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
            <tr>
              {["Order", "Purchaser", "Email", "Event", "Tier", "Units", "Admissions", "Subtotal", "Tax", "Total", "Status", "Refund", "Created"].map((label) => (
                <th key={label} className="py-2 pr-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.ref} className="border-t border-white/10">
                <td className="py-2 pr-3"><Link className="underline decoration-white/20 underline-offset-2" href={`/admin/orders?ref=${order.ref}`}>{order.ref}</Link></td>
                <td className="py-2 pr-3">{order.purchaser || "Guest"}</td>
                <td className="max-w-[12rem] truncate py-2 pr-3 text-white/70">{order.email}</td>
                <td className="py-2 pr-3">{order.eventName}</td>
                <td className="py-2 pr-3">{order.tier}</td>
                <td className="py-2 pr-3 tabular-nums">{order.units}</td>
                <td className="py-2 pr-3 tabular-nums">{order.admissions}</td>
                <td className="py-2 pr-3 tabular-nums">{money(order.subtotal, order.currency)}</td>
                <td className="py-2 pr-3 tabular-nums">{money(order.tax, order.currency)}</td>
                <td className="py-2 pr-3 tabular-nums">{money(order.total, order.currency)}</td>
                <td className="py-2 pr-3"><Chip tone={toneFor(order.paymentStatus)}>{order.paymentStatus}</Chip></td>
                <td className="py-2 pr-3"><Chip tone={toneFor(order.refundStatus)}>{order.refundStatus}</Chip></td>
                <td className="py-2 pr-3 text-white/60">{when(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={25} total={total} onPage={setPage} />
    </div>
  );
}

function OrderDetailView({ eventId, refCode }: { eventId: string; refCode: string }) {
  const router = useRouter();
  const valid = /^OMC-[0-9A-F]{8}$/i.test(refCode);
  const [loaded, setLoaded] = useState<{ key: string; detail: OrderDetail | null; error: string | null } | null>(null);
  const requestKey = `${eventId}|${refCode}`;

  useEffect(() => {
    if (!eventId || !valid) return;
    let cancel = false;
    adminCall<OrderDetail>("order", { eventId, ref: refCode.toUpperCase() })
      .then((body) => {
        if (!cancel) setLoaded({ key: requestKey, detail: body, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ key: requestKey, detail: null, error: err instanceof AdminApiError ? err.message : "Order not found." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, refCode, requestKey, valid]);

  const current = loaded?.key === requestKey ? loaded : null;
  const detail = current?.detail ?? null;
  const error = !valid ? "That order reference is not valid." : current?.error ?? null;

  return (
    <div>
      <button type="button" className="text-sm text-white/55" onClick={() => router.push("/admin/orders")}>
        Back to orders
      </button>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Order {refCode.toUpperCase()}</h1>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {valid && !current && <p className="mt-3 text-sm text-white/50">Loading order…</p>}
      {detail && (
        <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-[#171916] p-3 text-sm sm:grid-cols-2">
            <Item label="Order" value={detail.order.ref} />
            <Item label="Purchaser" value={detail.order.purchaser || "Guest"} />
            <Item label="Email" value={detail.order.email} />
            <Item label="Event" value={detail.order.eventName} />
            <Item label="Tier" value={detail.order.tier} />
            <Item label="Quantity" value={String(detail.order.units)} />
            <Item label="Admissions" value={String(detail.order.admissions)} />
            <Item label="Subtotal" value={money(detail.order.subtotal, detail.order.currency)} />
            <Item label="Tax" value={money(detail.order.tax, detail.order.currency)} />
            <Item label="Total" value={money(detail.order.total, detail.order.currency)} />
            <Item label="Payment" value={detail.order.paymentStatus} />
            <Item label="Refund" value={detail.order.refundStatus} />
            <Item label="Created" value={when(detail.order.createdAt)} />
            <Item label="Email status" value={detail.order.emailStatus} />
          </dl>
          {detail.order.paymentStatus === "paid" && (
            <Link href={`/admin/refunds?ref=${detail.order.ref}`} className="inline-block text-sm text-white/70 underline-offset-2 hover:underline">
              Refund this order
            </Link>
          )}
          <section className="rounded-lg border border-white/10 bg-[#171916] p-3">
            <h2 className="text-sm font-semibold">Passes</h2>
            {detail.tickets.length === 0 ? (
              <Empty>No passes on this order.</Empty>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Pass</th>
                      <th className="py-2 pr-3 font-medium">Guest</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium">Checked in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tickets.map((ticket) => (
                      <tr key={ticket.ref} className="border-t border-white/10">
                        <td className="py-2 pr-3">{ticket.ref}</td>
                        <td className="py-2 pr-3 tabular-nums">{ticket.guestNumber}</td>
                        <td className="py-2 pr-3"><Chip tone={toneFor(ticket.status)}>{ticket.status}</Chip></td>
                        <td className="py-2">{when(ticket.checkedInAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.14em] text-white/40">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
