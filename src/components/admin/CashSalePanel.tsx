"use client";

import { useState } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { money } from "./format";
import { ErrorNote, inputClass, quietButton } from "./ui";

const HIDDEN = new Set(["vip", "complimentary", "mixed"]);

interface QuoteLine {
  ticketType: string;
  name: string;
  quantity: number;
  admissions: number;
  lineSubtotal: number;
  discount: number;
  promoEligible: boolean;
}

interface CashQuote {
  lines: QuoteLine[];
  totalAdmissions: number;
  originalSubtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  promo: { code: string; percent: number; eligibleNames: string[] } | null;
}

function newKey() {
  return crypto.randomUUID();
}

export function CashSalePanel() {
  const { role, eventId, event } = useAdmin();
  if (role !== "super_admin") {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">Cash sale</h1>
        <p className="mt-2 text-sm text-white/60">Only a super admin can record a cash sale.</p>
      </div>
    );
  }
  if (!eventId || !event) return <p className="text-sm text-white/50">Choose an event.</p>;
  return <CashDesk key={eventId} />;
}

function CashDesk() {
  const { eventId, event } = useAdmin();
  const tiers = (event?.tiers ?? []).filter((tier) => tier.active && !tier.soldOut && tier.remaining !== 0 && !HIDDEN.has(tier.id));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [promo, setPromo] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<CashQuote | null>(null);
  const [key, setKey] = useState(newKey);
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function edit(update: () => void) {
    update();
    setQuote(null);
    setReceived(false);
    setKey(newKey());
  }

  function items() {
    return tiers
      .map((tier) => ({ ticket_type: tier.id, quantity: quantities[tier.id] ?? 0 }))
      .filter((item) => item.quantity > 0);
  }

  async function review() {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<CashQuote>("cash_quote", { eventId, items: items(), promoCode: promo });
      setQuote(body);
      setKey(newKey());
      setReceived(false);
    } catch (err: unknown) {
      setQuote(null);
      setError(err instanceof AdminApiError ? err.message : "The amount could not be calculated.");
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (!eventId || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const body = await adminCall<{ message: string; ref: string }>("cash_issue", {
        eventId,
        name,
        email,
        phone,
        items: items(),
        promoCode: promo,
        expectedTotal: quote.total,
        idempotencyKey: key,
        confirm: "CASH RECEIVED",
      });
      setMessage(`${body.message} Order ${body.ref}.`);
      setName("");
      setEmail("");
      setPhone("");
      setPromo("");
      setQuantities({});
      setQuote(null);
      setReceived(false);
      setKey(newKey());
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "The cash sale was not issued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Cash sale</h1>
      <p className="mt-1 text-sm text-white/55">
        Record money received in cash and issue the same paid tickets as checkout. This does not create a card charge.
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/55">
          Customer name
          <input className={`${inputClass} mt-1`} value={name} onChange={(e) => edit(() => setName(e.target.value))} required maxLength={80} />
        </label>
        <label className="text-xs text-white/55">
          Email
          <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(e) => edit(() => setEmail(e.target.value))} required maxLength={320} />
        </label>
        <label className="text-xs text-white/55">
          Phone <span className="text-white/35">optional</span>
          <input className={`${inputClass} mt-1`} value={phone} onChange={(e) => edit(() => setPhone(e.target.value))} maxLength={40} />
        </label>
        <label className="text-xs text-white/55">
          Promo code <span className="text-white/35">optional</span>
          <input className={`${inputClass} mt-1 uppercase`} value={promo} onChange={(e) => edit(() => setPromo(e.target.value))} maxLength={32} />
        </label>
      </div>

      <ul className="mt-4 divide-y divide-white/10 rounded-lg border border-white/10">
        {tiers.map((tier) => {
          const quantity = quantities[tier.id] ?? 0;
          return (
            <li key={tier.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="block text-sm font-medium">{tier.name}</span>
                <span className="text-xs text-white/45">{money(tier.priceCents, event?.currency)} · admits {tier.admits}</span>
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className={quietButton} aria-label={`Decrease ${tier.name}`} disabled={quantity < 1} onClick={() => edit(() => setQuantities((current) => ({ ...current, [tier.id]: Math.max(0, (current[tier.id] ?? 0) - 1) })))}>−</button>
                <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                <button type="button" className={quietButton} aria-label={`Increase ${tier.name}`} disabled={quantity >= 10} onClick={() => edit(() => setQuantities((current) => ({ ...current, [tier.id]: Math.min(10, (current[tier.id] ?? 0) + 1) })))}>+</button>
              </span>
            </li>
          );
        })}
      </ul>

      <button type="button" className={`${quietButton} mt-4`} disabled={busy || items().length === 0 || name.trim().length < 2} onClick={() => void review()}>
        {busy && !quote ? "Calculating…" : "Review amount"}
      </button>

      {quote && (
        <section className="mt-4 rounded-lg border border-white/10 bg-[#171916] p-3 text-sm" aria-label="Cash sale preview">
          <p className="font-medium">{name}</p>
          <p className="text-white/60">{email}</p>
          <ul className="mt-3 space-y-1">
            {quote.lines.map((line) => (
              <li key={line.ticketType} className="flex justify-between gap-3">
                <span>{line.name} × {line.quantity}</span>
                <span className="tabular-nums">{money(line.lineSubtotal, quote.currency)}{line.discount > 0 ? ` · −${money(line.discount, quote.currency)}` : ""}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-white/70">
            <div className="flex justify-between"><dt>Total admissions</dt><dd>{quote.totalAdmissions}</dd></div>
            <div className="flex justify-between"><dt>Original subtotal</dt><dd>{money(quote.originalSubtotal, quote.currency)}</dd></div>
            {quote.discount > 0 && <div className="flex justify-between"><dt>Promo discount</dt><dd>−{money(quote.discount, quote.currency)}</dd></div>}
            <div className="flex justify-between"><dt>Tax</dt><dd>{money(quote.tax, quote.currency)}</dd></div>
            <div className="flex justify-between text-white"><dt>Amount to collect</dt><dd className="font-semibold">{money(quote.total, quote.currency)}</dd></div>
            <div className="flex justify-between"><dt>Payment method</dt><dd>CASH</dd></div>
          </dl>
          <label className="mt-4 flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={received} onChange={(e) => setReceived(e.target.checked)} />
            <span>CASH RECEIVED</span>
          </label>
          <button
            type="button"
            className="mt-3 h-10 rounded-md bg-[#eceae4] px-4 text-sm font-semibold text-[#141513] disabled:opacity-40"
            disabled={!received || busy}
            onClick={() => void issue()}
          >
            {busy ? "Issuing…" : "Confirm cash & issue tickets"}
          </button>
        </section>
      )}
    </div>
  );
}
