"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { count, money, when } from "./format";
import type { PromoPerformance } from "./types";
import { Chip, Empty, ErrorNote, Panel, Stat, toneFor } from "./ui";

export function PromoPanel() {
  const { eventId, event, role } = useAdmin();
  const [loaded, setLoaded] = useState<{ eventId: string; data: PromoPerformance[] | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!eventId || role !== "super_admin") return;
    let cancel = false;
    adminCall<{ promotions: PromoPerformance[] }>("promo_report", { eventId })
      .then((body) => {
        if (!cancel) setLoaded({ eventId, data: body.promotions, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ eventId, data: null, error: err instanceof AdminApiError ? err.message : "Could not load promo performance." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId, role]);

  if (role !== "super_admin") return <ErrorNote>Promo performance is available to super admins.</ErrorNote>;
  if (!eventId) return <Empty>Choose an event.</Empty>;
  const current = loaded?.eventId === eventId ? loaded : null;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-white/40">Promo performance</p>
        <h1 className="text-xl font-semibold tracking-tight">{event?.name ?? "Event"}</h1>
        <p className="mt-1 text-sm text-white/55">
          Figures come from the price recorded on each order when it was paid. Orders count purchases; discounted admissions
          count the passes on the lines the code actually discounted, so a Couple or Group in the same cart is not counted.
        </p>
      </header>
      {!current && <p className="text-sm text-white/50">Loading promo performance…</p>}
      {current?.error && <ErrorNote>{current.error}</ErrorNote>}
      {current?.data && current.data.length === 0 && <Empty>No promo codes for this event.</Empty>}
      {current?.data?.map((promo) => <PromoSection key={promo.code} promo={promo} />)}
    </div>
  );
}

function PromoSection({ promo }: { promo: PromoPerformance }) {
  const s = promo.summary;
  const c = promo.currency;
  const discountLabel = promo.discountType === "percentage" ? `${promo.discountValue}%` : String(promo.discountValue);
  const orderHint = [
    `${count(s.currentOrders)} current`,
    s.refundedOrders ? `${count(s.refundedOrders)} refunded` : null,
    s.disputedOrders ? `${count(s.disputedOrders)} disputed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-wide">{promo.code}</h2>
        <Chip tone={promo.active ? "good" : "neutral"}>{promo.active ? "Active" : "Inactive"}</Chip>
        {promo.expiresAt && <span className="text-xs text-white/45">Expires {when(promo.expiresAt)}</span>}
        <Link href={`/admin/orders?promo=${encodeURIComponent(promo.code)}`} className="ml-auto text-xs text-white/55 underline-offset-2 hover:underline">
          Open in orders
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Code" value={promo.code} />
        <Stat label="Discount" value={discountLabel} />
        <Stat label={`Orders using ${promo.code}`} value={count(s.orders)} hint={orderHint} />
        <Stat
          label={`Discounted admissions via ${promo.code}`}
          value={count(s.admissionsActive)}
          hint={
            s.orderAdmissionsActive != null && s.orderAdmissionsActive !== s.admissionsActive
              ? `${count(s.admissionsIssued)} issued, including cancelled · ${count(s.orderAdmissionsActive)} admissions in these orders in total`
              : `${count(s.admissionsIssued)} issued, including cancelled`
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Original ticket value" value={money(s.originalValue, c)} />
        <Stat label="Total discounts given" value={money(s.discounts, c)} />
        <Stat label="Net ticket subtotal" value={money(s.netSubtotal, c)} hint="After discounts" />
        <Stat label="Tax collected" value={money(s.tax, c)} />
        <Stat label="Total paid" value={money(s.totalPaid, c)} />
      </div>
      <p className="text-xs text-white/45">
        These five figures leave out fully refunded and disputed orders. Partially refunded orders are counted at the original
        charge.
      </p>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label={`Gross ${promo.code} sales`} value={money(s.grossSales, c)} hint="Every order, as charged" />
        <Stat label="Refunds" value={money(s.refunds, c)} hint={`${count(s.refundedOrders)} fully refunded`} />
        <Stat label="Disputed" value={money(s.disputed, c)} hint={`${count(s.disputedOrders)} orders`} />
        <Stat label={`Net ${promo.code} revenue`} value={money(s.netRevenue, c)} />
      </div>

      <Panel title={`${promo.code} orders`} action={<span className="text-xs text-white/40">Admissions are passes, not purchase units</span>}>
        {promo.orders.length === 0 ? (
          <Empty>No orders have used {promo.code} yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[78rem] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
                <tr>
                  {[
                    "Order",
                    "Customer",
                    "Email",
                    "Ticket type",
                    "Qty / admissions",
                    "Promo",
                    "Original subtotal",
                    "Discount",
                    "After discount",
                    "Tax",
                    "Total paid",
                    "Status",
                    "Purchased",
                  ].map((label) => (
                    <th key={label} className="py-2 pr-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {promo.orders.map((order) => (
                  <tr key={order.ref} className="border-t border-white/10">
                    <td className="py-2 pr-3">
                      <Link className="underline decoration-white/20 underline-offset-2" href={`/admin/orders?ref=${order.ref}`}>
                        {order.ref}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{order.purchaser || "Guest"}</td>
                    <td className="max-w-[12rem] truncate py-2 pr-3 text-white/70">{order.email}</td>
                    <td className="py-2 pr-3">{order.tier}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {order.units} / {order.admissions}
                      {order.discountedAdmissions != null && order.discountedAdmissions !== order.admissions && (
                        <span className="text-white/45"> · {order.discountedAdmissions} discounted</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{order.promoCode}{order.discountPercent != null && <span className="text-white/45"> · {order.discountPercent}%</span>}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(order.originalSubtotal, order.currency)}</td>
                    <td className="py-2 pr-3 tabular-nums">−{money(order.discount, order.currency)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(order.subtotal, order.currency)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(order.tax, order.currency)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(order.total, order.currency)}</td>
                    <td className="py-2 pr-3"><Chip tone={toneFor(order.paymentStatus)}>{order.paymentStatus}</Chip></td>
                    <td className="py-2 pr-3 text-white/60">{when(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}
