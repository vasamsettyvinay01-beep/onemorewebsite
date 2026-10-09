"use client";

import { adminCall } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { count } from "./format";
import type { AdminEvent } from "./types";
import { Chip, Empty, toneFor } from "./ui";
import { useEffect, useState } from "react";

export function EventsPanel() {
  const { setEventId, eventId } = useAdmin();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    adminCall<{ events: AdminEvent[] }>("events")
      .then((body) => {
        if (!cancel) setEvents(body.events);
      })
      .catch(() => {
        if (!cancel) setError("Could not load events.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (error) return <p className="text-sm text-rose-100">{error}</p>;
  if (!events) return <p className="text-sm text-white/50">Loading events…</p>;
  if (events.length === 0) return <Empty>No events are configured.</Empty>;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Events</h1>
      <p className="mt-1 text-sm text-white/50">Read only. Event details are not editable here.</p>
      <div className="mt-4 space-y-3">
        {events.map((event) => (
          <article key={event.id} className="rounded-lg border border-white/10 bg-[#171916] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{event.name}</h2>
                <p className="mt-1 text-sm text-white/55">{[event.date, event.time, event.venue].filter(Boolean).join(" · ") || "Details not on file"}</p>
                {event.address && <p className="text-xs text-white/40">{event.address}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip tone={toneFor(event.status)}>{event.status}</Chip>
                <Chip tone={toneFor(event.salesStatus)}>Sales {event.salesStatus}</Chip>
                {event.age && <Chip>Age {event.age}+</Chip>}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Capacity" value={event.capacity == null ? "No cap" : count(event.capacity)} />
              <Metric label="Remaining" value={event.remainingCapacity == null ? "—" : count(event.remainingCapacity)} />
              <Metric label="Units sold" value={count(event.unitsSold)} />
              <Metric label="Admissions sold" value={count(event.admissionsSold)} />
              <Metric label="Passes issued" value={count(event.passesIssued)} />
              <Metric label="Uncapped tiers" value={count(event.uncappedTiers)} />
            </dl>
            <button type="button" className="mt-3 text-sm text-white/70 underline decoration-white/20" onClick={() => setEventId(event.id)}>
              {event.id === eventId ? "Showing in the dashboard" : "Use this event"}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-[0.14em] text-white/40">{label}</dt>
      <dd className="mt-0.5 tabular-nums">{value}</dd>
    </div>
  );
}
