"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import {
  getHousePartyStatus,
  spotsLabel,
  submitHousePartyRsvp,
  type HousePartyFailure,
  type HousePartyStatus,
  type HousePartySuccess,
} from "@/lib/house-party";
import { housePartyArrival } from "@/lib/house-party-arrival";
import { HousePartyPassCard } from "./HousePartyPassCard";

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  instagram: string;
  partySize: number;
  guestNames: string[];
  ageConfirmed: boolean;
};

const emptyForm: FormState = {
  fullName: "",
  email: "",
  phone: "",
  instagram: "",
  partySize: 1,
  guestNames: [],
  ageConfirmed: false,
};

const ticketHref = "/checkout?event=diwali-night";
const partyOptions = [
  { value: 1, label: "1 — Just me" },
  { value: 2, label: "2 — Two people" },
  { value: 3, label: "3 — Three people" },
  { value: 4, label: "4 — Four people" },
] as const;

export function HousePartyRsvpExperience() {
  const [availability, setAvailability] = useState<HousePartyStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState<HousePartyFailure | null>(null);
  const [confirmation, setConfirmation] = useState<HousePartySuccess | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void getHousePartyStatus(controller.signal)
      .then((next) => {
        setAvailability(next);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
    return () => controller.abort();
  }, []);

  const guestIndexes = useMemo(() => Array.from({ length: Math.max(0, form.partySize - 1) }, (_, index) => index), [form.partySize]);
  const maxPartySize = Math.min(4, Math.max(1, availability?.spotsRemaining ?? 4));

  useEffect(() => {
    if (!availability || availability.state !== "active" || availability.spotsRemaining < 1) return;
    const limit = Math.min(4, availability.spotsRemaining);
    if (form.partySize <= limit) return;
    changePartySize(limit);
    // Clamp only when the server reports a smaller remaining count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

  function changePartySize(value: number) {
    const partySize = Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1;
    setForm((current) => ({
      ...current,
      partySize,
      guestNames: current.guestNames.slice(0, partySize - 1).concat(Array(Math.max(0, partySize - 1 - current.guestNames.length)).fill("")),
    }));
  }

  function changeGuest(index: number, value: string) {
    setForm((current) => {
      const guestNames = [...current.guestNames];
      guestNames[index] = value;
      return { ...current, guestNames };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice(null);
    const result = await submitHousePartyRsvp({ ...form, partySize: Math.min(form.partySize, maxPartySize) });
    submitting.current = false;
    setBusy(false);

    if (result.status === "confirmed") {
      setConfirmation(result);
      setAvailability((current) =>
        current
          ? {
              ...current,
              state: result.spotsRemaining === 0 ? "full" : "active",
              confirmedPeople: current.confirmedPeople + result.partySize,
              rsvpGroups: current.rsvpGroups + 1,
              spotsRemaining: result.spotsRemaining,
            }
          : current,
      );
      return;
    }

    setNotice(result);
    if (result.status === "full") {
      setAvailability((current) => current && { ...current, state: "full", spotsRemaining: 0 });
    } else if (result.status === "ended") {
      setAvailability((current) => current && { ...current, state: "ended", spotsRemaining: 0 });
    } else if (typeof result.spotsRemaining === "number") {
      const spotsRemaining = result.spotsRemaining;
      setAvailability((current) => current && { ...current, spotsRemaining });
    }
  }

  if (confirmation) return <Confirmation result={confirmation} guestNames={form.guestNames} fallbackName={form.fullName} />;
  if (!availability) return <LoadingState failed={loadFailed} />;
  if (availability.state === "ended") return <EndedState />;
  if (availability.state === "full") return <FullState />;

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-[#0f0f10] pb-12 pt-8 text-[#f6f1e8] sm:pb-16 sm:pt-12">
      <Atmosphere />
      <div className="page-container relative z-10">
        <Link href="/" className="eyebrow text-[#c6a15b] transition-colors hover:text-[#f6f1e8]">
          The One More Company
        </Link>
        <div className="mx-auto mt-9 grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)] lg:items-start">
          <section className="max-w-xl">
            <p className="eyebrow text-[#df8a42]">Tonight · Oct 30</p>
            <h1 className="mt-3 font-headline text-[clamp(2.7rem,13vw,5.7rem)] text-[#f6f1e8]">
              Diwali × Halloween
              <span className="block text-[#c6a15b]">House Party</span>
            </h1>
            <p className="mt-5 max-w-lg font-display text-[1.55rem] leading-[1.05] text-[#f6f1e8]/85">
              Tonight is the trailer.<br />November 7 is the main event.
            </p>
            <p className="mt-6 max-w-xl text-[0.95rem] leading-7 text-[#f6f1e8]/70">
              A private night of music, dancing, games, drinks and good vibes — and your first taste of what ONE MORE is bringing on Nov 7.
            </p>
            <ul className="mt-7 grid grid-cols-2 gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#f6f1e8]/80">
              {["Free entry", "No cover", "No payment required", "RSVP required", "Only 30 people", "21+ only", "BYOB", "Snacks & sodas on us"].map((item) => (
                <li key={item} className="border border-[#c6a15b]/30 px-3 py-2">{item}</li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-6 text-[#f6f1e8]/70">Music, games, and good vibes. Bring your own drinks — we are not selling alcohol. Bring a valid 21+ photo ID.</p>
          </section>

          <section aria-labelledby="rsvp-heading" className="relative rounded-[4px] border border-[#c6a15b]/50 bg-[#181313]/90 p-5 shadow-[0_28px_80px_-35px_rgba(0,0,0,1),0_0_70px_-32px_rgba(223,93,39,0.9)] backdrop-blur-xl sm:p-7">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-[#9d3b20]/25 blur-3xl" />
            <div className="relative">
              <p className="eyebrow text-[#df8a42]">Free entry</p>
              <h2 id="rsvp-heading" className="mt-2 font-headline text-3xl text-[#f6f1e8]">Only 30 Spots</h2>
              <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/60">No cover · No payment required · RSVP required</p>
              <p className={`mt-3 inline-flex border px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.17em] ${availability.spotsRemaining <= 5 ? "border-[#df8a42] bg-[#7d2018]/40 text-[#f6c28e]" : "border-[#c6a15b]/45 bg-[#c6a15b]/10 text-[#c6a15b]"}`}>
                {spotsLabel(availability.spotsRemaining)}
              </p>

              {notice && <Notice notice={notice} />}
              <form className="mt-6 space-y-4 [color-scheme:dark]" onSubmit={submit}>
                <Field label="Full name" id="full-name">
                  <input id="full-name" required autoComplete="name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} className={inputClass} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Email" id="email">
                    <input id="email" required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={inputClass} />
                  </Field>
                  <Field label="Phone number" id="phone">
                    <input id="phone" required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={inputClass} />
                  </Field>
                </div>
                <Field label="Instagram (optional)" id="instagram">
                  <input id="instagram" autoComplete="off" value={form.instagram} onChange={(event) => setForm((current) => ({ ...current, instagram: event.target.value }))} className={inputClass} />
                </Field>
                <div>
                  <p id="party-size-label" className="mb-1.5 flex justify-between text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/58">
                    Number of people <span className="text-[#f6f1e8]/35">Includes you</span>
                  </p>
                  <PartySizeField value={form.partySize} max={maxPartySize} onChange={changePartySize} />
                </div>
                {guestIndexes.length > 0 && (
                  <fieldset className="border-t border-[#f6f1e8]/10 pt-4">
                    <legend className="eyebrow text-[#f6f1e8]/65">Additional guests</legend>
                    <div className="mt-3 space-y-3">
                      {guestIndexes.map((index) => (
                        <Field key={index} label={`Guest ${index + 1} full name`} id={`guest-${index + 1}`}>
                          <input id={`guest-${index + 1}`} required autoComplete="name" value={form.guestNames[index] ?? ""} onChange={(event) => changeGuest(index, event.target.value)} className={inputClass} />
                        </Field>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label className="flex cursor-pointer gap-3 border-t border-[#f6f1e8]/10 pt-4 text-xs leading-5 text-[#f6f1e8]/70">
                  <input required checked={form.ageConfirmed} onChange={(event) => setForm((current) => ({ ...current, ageConfirmed: event.target.checked }))} type="checkbox" className="mt-0.5 size-4 accent-[#c6a15b]" />
                  <span>I understand this is a private 21+ event and everyone in my RSVP must be 21+.</span>
                </label>
                <button disabled={busy} className="h-12 w-full bg-[#c6a15b] text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[#0f0f10] shadow-[0_12px_30px_-18px_rgba(198,161,91,0.9)] transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-px hover:bg-[#e4c98a] hover:shadow-[0_16px_34px_-16px_rgba(228,201,138,0.95)] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70" type="submit">
                  {busy ? "Confirming RSVP..." : "Claim Free RSVP"}
                </button>
                <p className="text-center text-[0.62rem] font-semibold uppercase leading-5 tracking-[0.12em] text-[#f6f1e8]/55">Free entry · Only 30 spots · 21+ only · BYOB · Private location</p>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 flex justify-between text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/58">
        {label}<span className="text-[#f6f1e8]/35">{hint}</span>
      </span>
      {children}
    </label>
  );
}

function Notice({ notice }: { notice: HousePartyFailure }) {
  const duplicate = notice.status === "duplicate";
  return (
    <div className="mt-5 border border-[#df8a42]/50 bg-[#7d2018]/25 px-4 py-3 text-sm text-[#f6f1e8]/85" role="alert">
      <p className="font-semibold uppercase tracking-[0.11em]">{notice.error}</p>
      {duplicate && <p className="mt-1.5 text-xs leading-5">Your existing reservation is for {notice.existingPartySize} {notice.existingPartySize === 1 ? "person" : "people"}. Contact ONE MORE to make changes.</p>}
      {notice.status === "insufficient_capacity" && <p className="mt-1.5 text-xs leading-5">Please RSVP for {notice.spotsRemaining} {notice.spotsRemaining === 1 ? "person" : "people"}.</p>}
    </div>
  );
}

function LoadingState({ failed }: { failed: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0f0f10] px-6 text-center text-[#f6f1e8]">
      <div>
        <p className="eyebrow text-[#c6a15b]">The One More Company</p>
        <p className="mt-4 font-display text-3xl">{failed ? "RSVP availability is unavailable right now." : "Checking RSVP availability…"}</p>
        {failed && <Link href={ticketHref} className="mt-7 inline-block border border-[#c6a15b] px-5 py-3 text-[0.67rem] font-semibold uppercase tracking-[0.15em] text-[#f6f1e8]">Get Nov 7 Tickets</Link>}
      </div>
    </main>
  );
}

function Confirmation({ result, guestNames, fallbackName }: { result: HousePartySuccess; guestNames: string[]; fallbackName: string }) {
  const count = result.partySize;
  return (
    <main className="min-h-dvh overflow-x-clip bg-[#0f0f10] px-4 py-10 text-center text-[#f6f1e8]">
      <Atmosphere />
      <div className="relative mx-auto max-w-xl">
        <p className="eyebrow text-[#df8a42]">Free entry</p>
        <h1 className="mt-4 font-headline text-[clamp(3rem,15vw,6rem)]">You&apos;re in. 🔥</h1>
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.14em]">Your free RSVP is confirmed.</p>
        <p className="mt-3 font-headline text-5xl">{count} {count === 1 ? "Person" : "People"}</p>
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/75">Tonight · 9 PM onwards · 21+ only · BYOB</p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#f6f1e8]/70">
          {result.emailSent === false
            ? "Your free RSVP is confirmed. The email did not send — contact ONE MORE and we will resend your House Party Pass."
            : "Check your email for your House Party Pass and arrival instructions."}
        </p>
        <div className="mt-8 text-left">
          <HousePartyPassCard fullName={result.fullName || fallbackName} partySize={count} guestNames={guestNames} code={result.passToken ? result.passToken.slice(0, 8).toUpperCase() : ""} token={result.passToken} />
        </div>
        <a href={housePartyArrival.href} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex h-12 w-full max-w-md items-center justify-center bg-[#c6a15b] text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[#0f0f10]">Open arrival location</a>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#f6f1e8]/70">Arrive at the shared location. Contact us when you arrive and we&apos;ll guide you to the house.</p>
        <p className="mt-8 font-display text-2xl leading-none text-[#c6a15b]">Tonight is the trailer.<br />November 7 is the main event.</p>
        <Link href={ticketHref} className="mt-6 inline-flex h-12 items-center bg-[#c6a15b] px-6 text-[0.67rem] font-semibold uppercase tracking-[0.15em] text-[#0f0f10]">Get Nov 7 Tickets</Link>
      </div>
    </main>
  );
}

function FullState() {
  return (
    <main className="grid min-h-dvh place-items-center overflow-hidden bg-[#0f0f10] px-6 text-center text-[#f6f1e8]">
      <Atmosphere />
      <div className="relative max-w-lg">
        <p className="eyebrow text-[#df8a42]">Tonight</p>
        <h1 className="mt-4 font-headline text-[clamp(3rem,15vw,5.7rem)]">House Full 🔥</h1>
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.15em] text-[#f6f1e8]/70">All 30 free spots are claimed.</p>
        <p className="mt-8 font-display text-3xl text-[#c6a15b]">Tonight is the trailer.<br />November 7 is the main event.</p>
        <Link href={ticketHref} className="mt-9 inline-flex h-12 items-center bg-[#c6a15b] px-6 text-[0.67rem] font-semibold uppercase tracking-[0.15em] text-[#0f0f10] transition-colors hover:bg-[#f6f1e8]">Get Nov 7 Tickets</Link>
      </div>
    </main>
  );
}

function EndedState() {
  return (
    <main className="grid min-h-dvh place-items-center overflow-hidden bg-[#0f0f10] px-6 text-center text-[#f6f1e8]">
      <Atmosphere />
      <div className="relative max-w-lg">
        <p className="eyebrow text-[#c6a15b]">The One More Company</p>
        <h1 className="mt-4 font-headline text-[clamp(2.7rem,14vw,5rem)]">This Event Has Ended.</h1>
        <p className="mt-8 font-display text-3xl text-[#c6a15b]">Tonight was the trailer.<br />November 7 is the main event.</p>
        <Link href={ticketHref} className="mt-9 inline-flex h-12 items-center bg-[#c6a15b] px-6 text-[0.67rem] font-semibold uppercase tracking-[0.15em] text-[#0f0f10] transition-colors hover:bg-[#f6f1e8]">Get Nov 7 Tickets</Link>
      </div>
    </main>
  );
}

function Atmosphere() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_8%,rgba(151,55,26,0.27),transparent_37%),radial-gradient(ellipse_at_10%_100%,rgba(198,161,91,0.15),transparent_43%)]" />
      <div aria-hidden className="grain absolute inset-0 opacity-[0.09]" />
    </>
  );
}

function PartySizeField({ value, max, onChange }: { value: number; max: number; onChange: (size: number) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = partyOptions.find((option) => option.value === value) ?? partyOptions[0];

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function move(direction: 1 | -1 | "start" | "end") {
    const enabled = partyOptions.filter((option) => option.value <= max);
    const index = enabled.findIndex((option) => option.value === value);
    const next = direction === "start" ? enabled[0] : direction === "end" ? enabled[enabled.length - 1] : enabled[Math.min(enabled.length - 1, Math.max(0, index + direction))];
    if (next) onChange(next.value);
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move("start");
    } else if (event.key === "End") {
      event.preventDefault();
      move("end");
    } else if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        id="party-size"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="party-size-label party-size"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-12 w-full items-center justify-between rounded-[2px] border border-[#c6a15b] bg-[#0f0f10] px-3 text-left text-sm uppercase tracking-[0.08em] text-[#f6f1e8] outline-none focus-visible:ring-2 focus-visible:ring-[#c6a15b]"
      >
        <span>{selected.label}</span>
        <span aria-hidden className="text-[#c6a15b]">▾</span>
      </button>
      {open && (
        <ul
          ref={list}
          id="party-size-list"
          role="listbox"
          aria-label="Number of people"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute z-30 mt-1 w-full rounded-[2px] border border-[#c6a15b] bg-[#141011] p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,1)] outline-none"
        >
          {partyOptions.map((option) => {
            const unavailable = option.value > max;
            const active = option.value === value;
            return (
              <li key={option.value} id={`party-size-${option.value}`} role="option" aria-selected={active} aria-disabled={unavailable}>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex min-h-12 w-full items-center px-3 text-left text-sm uppercase tracking-[0.08em] disabled:cursor-not-allowed disabled:text-[#f6f1e8]/28 ${active ? "bg-[#c6a15b] text-[#0f0f10]" : "text-[#f6f1e8] hover:bg-[#c6a15b]/15"}`}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const inputClass = "h-12 w-full rounded-[2px] border border-[#f6f1e8]/15 bg-[#0f0f10] px-3 text-sm text-[#f6f1e8] outline-none transition-colors placeholder:text-[#f6f1e8]/30 focus:border-[#c6a15b]";
