"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { count, inRange, money, when } from "./format";
import type { Overview, TimelinePoint } from "./types";
import { Chip, Empty, ErrorNote, Panel, Stat, toneFor } from "./ui";

export function OverviewPanel() {
  const { eventId, event } = useAdmin();
  const [loaded, setLoaded] = useState<{ eventId: string; data: Overview | null; error: string | null } | null>(null);
  const [range, setRange] = useState<"today" | "7d" | "all">("7d");

  useEffect(() => {
    if (!eventId) return;
    let cancel = false;
    adminCall<Overview>("overview", { eventId })
      .then((body) => {
        if (!cancel) setLoaded({ eventId, data: body, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ eventId, data: null, error: err instanceof AdminApiError ? err.message : "Could not load the overview." });
      });
    return () => {
      cancel = true;
    };
  }, [eventId]);

  const current = loaded?.eventId === eventId ? loaded : null;
  if (!eventId) return <Empty>No event is available.</Empty>;
  if (!current) return <p className="text-sm text-white/50">Loading overview…</p>;
  if (current.error || !current.data) return <ErrorNote>{current.error ?? "Could not load the overview."}</ErrorNote>;
  const data = current.data;

  const zone = data.event.timezone || "UTC";
  const today = data.timeline.today;
  const points = today ? data.timeline.points.filter((point) => inRange(point.date, today, range)) : data.timeline.points;
  const capacityHint = data.uncappedTiers > 0 ? `${data.uncappedTiers} tier${data.uncappedTiers === 1 ? "" : "s"} with no cap` : undefined;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.16em] text-white/40">Overview</p>
          <h1 className="text-xl font-semibold tracking-tight">{data.event.name}</h1>
          <p className="mt-1 text-sm text-white/55">
            {[data.event.date, data.event.time, data.event.venue].filter(Boolean).join(" · ") || "Details not on file"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={toneFor(data.event.status)}>{data.event.status}</Chip>
          <Chip tone={toneFor(data.event.salesStatus)}>{data.event.salesStatus}</Chip>
          {data.event.age && <Chip>Age {data.event.age}+</Chip>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Gross sales" value={money(data.grossSales, data.currency)} />
        <Stat label="Orders" value={count(data.orders)} />
        <Stat label="Admissions sold" value={count(data.admissionsSold)} hint={`${count(data.passesIssued)} issued`} />
        <Stat label="Capacity" value={data.capacity == null ? "No cap" : count(data.capacity)} hint={capacityHint} />
        <Stat label="Remaining capacity" value={data.remainingCapacity == null ? "—" : count(data.remainingCapacity)} hint={capacityHint} />
        <Stat label="Checked in" value={count(data.checkedIn)} />
        <Stat label="Guests remaining" value={count(data.guestsRemaining)} />
        <Stat label="Active holds" value={count(data.activeHolds)} />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Ticket subtotal" value={money(data.ticketSubtotal, data.currency)} />
        <Stat label="Tax collected" value={money(data.taxCollected, data.currency)} />
        <Stat label="Refunded amount" value={money(data.refundedAmount, data.currency)} />
        <Stat label="Cancelled passes" value={count(data.cancelledPasses)} />
        <Stat label="Sales" value={data.event.salesStatus} />
      </div>
      {!data.totalsComplete && <p className="text-xs text-white/45">Some orders could not be split into subtotal and tax from the catalog price.</p>}

      <Panel
        title="Sales by tier"
        action={<span className="text-xs text-white/40">Admissions are passes, not purchase units</span>}
      >
        {data.tiers.length === 0 ? (
          <Empty>No tiers on file.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
                <tr>
                  <th className="py-2 pr-3 font-medium">Tier</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Units sold</th>
                  <th className="py-2 pr-3 font-medium">Admissions issued</th>
                  <th className="py-2 pr-3 font-medium">Capacity</th>
                  <th className="py-2 pr-3 font-medium">Remaining</th>
                  <th className="py-2 pr-3 font-medium">Revenue</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.id} className="border-t border-white/10">
                    <td className="py-2 pr-3">
                      {tier.name}
                      {tier.admits > 1 && <span className="mt-0.5 block text-xs text-white/40">{tier.admits} admissions each</span>}
                      {tier.unitsRefunded > 0 && <span className="mt-0.5 block text-xs text-white/40">{tier.unitsRefunded} refunded units</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{money(tier.priceCents, tier.currency)}</td>
                    <td className="py-2 pr-3 tabular-nums">{count(tier.unitsSold)}</td>
                    <td className="py-2 pr-3 tabular-nums">{count(tier.admissionsIssued)}</td>
                    <td className="py-2 pr-3 tabular-nums">{tier.capacity == null ? "No cap" : count(tier.capacity)}</td>
                    <td className="py-2 pr-3 tabular-nums">{tier.remaining == null ? "—" : count(tier.remaining)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(tier.revenue, tier.currency)}</td>
                    <td className="py-2"><Chip tone={toneFor(tier.status)}>{tier.status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Sales over time"
        action={
          <div className="flex gap-1">
            {(["today", "7d", "all"] as const).map((item) => (
              <button key={item} type="button" className={range === item ? "rounded bg-white/15 px-2 py-1 text-xs" : "rounded px-2 py-1 text-xs text-white/50"} onClick={() => setRange(item)}>
                {item === "7d" ? "7 days" : item === "all" ? "All time" : "Today"}
              </button>
            ))}
          </div>
        }
      >
        {points.length === 0 ? <Empty>No sales in this range.</Empty> : <Timeline points={points} currency={data.currency} />}
      </Panel>

      <Panel title="Recent orders" action={<Link href="/admin/orders" className="text-xs text-white/55">All orders</Link>}>
        {data.recentOrders.length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
                <tr>
                  {["Order", "Customer", "Tier", "Qty", "Admissions", "Total", "Status", "Created"].map((label) => (
                    <th key={label} className="py-2 pr-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((order) => (
                  <tr key={order.ref} className="border-t border-white/10">
                    <td className="py-2 pr-3"><Link className="underline decoration-white/20 underline-offset-2" href={`/admin/orders?ref=${order.ref}`}>{order.ref}</Link></td>
                    <td className="py-2 pr-3">{order.purchaser || "Guest"}</td>
                    <td className="py-2 pr-3">{order.tier}</td>
                    <td className="py-2 pr-3 tabular-nums">{order.units}</td>
                    <td className="py-2 pr-3 tabular-nums">{order.admissions}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(order.total, order.currency)}</td>
                    <td className="py-2 pr-3"><Chip tone={toneFor(order.paymentStatus)}>{order.paymentStatus}</Chip></td>
                    <td className="py-2 pr-3 text-white/70">{when(order.createdAt, zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {event?.address && <p className="text-xs text-white/35">{event.address}</p>}
    </div>
  );
}

function Timeline({ points, currency }: { points: TimelinePoint[]; currency: string }) {
  const max = Math.max(...points.map((point) => point.charged), 1);
  return (
    <div className="space-y-2">
      {points.map((point) => (
        <div key={point.date} className="grid grid-cols-1 gap-1 border-t border-white/10 py-2 text-sm sm:grid-cols-[7rem_1fr_auto]">
          <span className="tabular-nums text-white/70">{point.date}</span>
          <div className="min-w-0">
            <div className="h-1.5 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-white/50" style={{ width: `${Math.max(4, Math.round((point.charged / max) * 100))}%` }} />
            </div>
            <p className="mt-1 text-xs text-white/45">{point.orders} orders · {point.issued} admissions issued</p>
          </div>
          <span className="tabular-nums sm:text-right">
            {money(point.charged, currency)}
            {point.refunded > 0 && <span className="mt-0.5 block text-xs text-white/40">{money(point.refunded, currency)} refunded</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
