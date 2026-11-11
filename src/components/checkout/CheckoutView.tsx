"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe, type Appearance, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeExpressCheckoutElementClickEvent, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { brand } from "@/data/brand";
import { PolicyAck } from "@/components/checkout/PolicyAck";
import { backend, backendConfigured, functionUrl } from "@/data/backend";
import { useLiveEvent } from "@/lib/availability";
import {
  MAX_CART_ADMISSIONS,
  NON_PUBLIC_TIER_IDS,
  admitsOf,
  canDecrease,
  canIncrease,
  cartAdmissions,
  cartItems,
  cartKey,
  cartSelections,
  clampQuantities,
  normaliseLines,
  promoScopeLabel,
  requestBody,
  type CartItem,
  type Quantities,
  type QuoteLine,
} from "@/lib/cart";
import { formatChapter, formatEventTime, getEventBySlug, getVisibleTiers, hasPublicDate, isOnSale, waitingFor } from "@/lib/events";
import type { SalesPhase } from "@/lib/event-end";
import { useSalesPhase } from "@/lib/use-lifecycle";
import { cn } from "@/lib/cn";
import type { OneMoreEvent, TicketTier } from "@/types/event";

const stripePromise = backend.stripeKey ? loadStripe(backend.stripeKey) : null;

const PROMO_INVALID = "PROMO CODE NOT VALID";

interface Quote {
  key: string;
  subtotal: number;
  discount: number;
  discountedSubtotal: number;
  tax: number;
  total: number;
  lines: QuoteLine[];
  promo: { code: string; percent: number; eligibleNames: string[] } | null;
}

function exactMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

function promoRejectionMessage(status: number, body: unknown): string | null {
  if (status !== 422 || !body || typeof body !== "object") return null;
  const code = "code" in body ? body.code : undefined;
  const error = "error" in body ? body.error : undefined;
  if (code === "PROMO_NOT_ELIGIBLE" && typeof error === "string" && error.trim()) return error;
  if (code === "promo_invalid" || code === "PROMO_NOT_ELIGIBLE") return PROMO_INVALID;
  return null;
}

interface SingleTicket {
  id: string;
  name: string;
  unitCents: number;
  quantity: number;
  admits: number;
}

function readQuote(key: string, body: Record<string, unknown>, single: SingleTicket | null): Quote | null {
  if (typeof body.total !== "number" || typeof body.tax !== "number" || typeof body.subtotal !== "number") return null;
  const lines = normaliseLines(body, single);
  if (!lines) return null;
  const promo = body.promo as { code?: unknown; percent?: unknown; eligibleNames?: unknown } | null | undefined;
  let scope: string[] = lines.filter((line) => line.discount > 0).map((line) => line.name);
  if (promo && Array.isArray(promo.eligibleNames)) {
    const named = promo.eligibleNames.filter((value): value is string => typeof value === "string");
    if (named.length > 0) scope = named;
  }
  return {
    key,
    subtotal: body.subtotal,
    discount: typeof body.discount === "number" ? body.discount : 0,
    discountedSubtotal: typeof body.discountedSubtotal === "number" ? body.discountedSubtotal : body.subtotal,
    tax: body.tax,
    total: body.total,
    lines,
    promo: promo && typeof promo.code === "string" && typeof promo.percent === "number" ? { code: promo.code, percent: promo.percent, eligibleNames: scope } : null,
  };
}

const GOLD = "#BB9B63";
const IVORY = "#ECEAE4";
const RICH = "#0F100F";
const FIELD = "#161715";

const appearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: GOLD,
    colorBackground: FIELD,
    colorText: IVORY,
    colorTextSecondary: "rgba(236,234,228,0.62)",
    colorTextPlaceholder: "rgba(236,234,228,0.32)",
    colorDanger: "#E7A598",
    colorIcon: "rgba(236,234,228,0.62)",
    fontFamily: "Manrope, 'Helvetica Neue', Arial, sans-serif",
    fontSizeBase: "14px",
    borderRadius: "2px",
    spacingUnit: "2px",
    gridRowSpacing: "8px",
  },
  rules: {
    ".Input": {
      backgroundColor: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(236,234,228,0.16)",
      boxShadow: "none",
      padding: "9px 12px",
      color: IVORY,
    },
    ".Input:hover": { border: "1px solid rgba(187,155,99,0.45)" },
    ".Input:focus": { border: `1px solid ${GOLD}`, boxShadow: "none" },
    ".Input--invalid": { border: "1px solid #E7A598", boxShadow: "none" },
    ".Label": {
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: "rgba(236,234,228,0.5)",
      marginBottom: "6px",
    },
    ".Tab": { border: "1px solid rgba(236,234,228,0.16)", boxShadow: "none", color: IVORY, backgroundColor: RICH },
    ".Tab--selected": { border: `1px solid ${GOLD}`, color: IVORY, backgroundColor: FIELD },
    ".Error": { fontSize: "12px" },
  },
};

const fonts: StripeElementsOptions["fonts"] = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&display=swap" },
];

function longDate(event: OneMoreEvent): string | undefined {
  if (!hasPublicDate(event)) return undefined;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(`${event.date}T12:00:00`),
  );
}

export function CheckoutView() {
  const params = useSearchParams();
  const staticEvent = getEventBySlug(params.get("event") ?? "") ?? null;
  const event = useLiveEvent(staticEvent, true);
  const phase = useSalesPhase(event);
  // A payment already confirming when sales close finishes here; only new attempts are refused.
  const [paying, setPaying] = useState(false);
  const open = !!event && backendConfigured && !!stripePromise && isOnSale(event) && (phase === "open" || (paying && phase !== null));

  const date = event ? longDate(event) : undefined;
  const when = [date?.replace(/, \d{4}$/, ""), event ? formatEventTime(event) : undefined].filter(Boolean).join(" · ");

  return (
    <main className="fixed inset-0 overflow-y-auto bg-rich text-ivory">
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-center px-5 py-4 sm:px-8">
        <div className="flex w-full min-w-0 flex-col">
          <header className="shrink-0">
            <Link href="/" aria-label={brand.name} className="inline-flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logo.sealPath} alt="" width={32} height={32} className="size-8" />
            </Link>
            {event && open ? (
              <>
                <p className="eyebrow mt-4 flex items-center gap-3 text-gold">
                  {event.chapter !== undefined && (
                    <>
                      <span>{formatChapter(event.chapter, true)}</span>
                      <span className="h-px w-6 bg-current opacity-60" />
                    </>
                  )}
                  <span>Payment</span>
                </p>
                <h1 className="mt-2 font-display text-[2.15rem] leading-[0.92] sm:text-[2.6rem]">{event.name}</h1>
                <p className="mt-2 text-[0.66rem] uppercase tracking-[0.14em] text-ivory-muted">
                  {[when, event.venue?.name, event.city, event.minimumAge ? `${event.minimumAge}+` : undefined]
                    .filter(Boolean)
                    .join("  ·  ")}
                </p>
              </>
            ) : null}
          </header>

          {event && open ? (
            <div className="mt-5 flex min-h-0 flex-col">
              <Elements stripe={stripePromise} options={elementsOptions(1)}>
                <CheckoutCard event={event} initialTier={params.get("tier")} onPayingChange={setPaying} />
              </Elements>
            </div>
          ) : (
            <Closed event={event} phase={phase} />
          )}
        </div>
      </div>
    </main>
  );
}

function elementsOptions(amount: number): StripeElementsOptions {
  return {
    mode: "payment",
    amount,
    currency: "usd",
    allowedPaymentMethodTypes: ["card"],
    appearance,
    fonts,
  };
}

function CheckoutCard({
  event,
  initialTier,
  onPayingChange,
}: {
  event: OneMoreEvent;
  initialTier: string | null;
  onPayingChange: (paying: boolean) => void;
}) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  // Public, fixed-price passes only. The server rejects anything else regardless of what is shown.
  const tiers = getVisibleTiers(event).filter((t) => !t.priceOnRequest && !NON_PUBLIC_TIER_IDS.includes(t.id.toLowerCase()));
  const buyable = tiers.filter((t) => !t.soldOut && !t.unavailable && !waitingFor(event, t));
  // Tickets start at none. A ticket chosen on the previous sheet arrives as a single ticket.
  const [picked, setPicked] = useState<Quantities>(() => (initialTier && buyable.some((t) => t.id === initialTier) ? { [initialTier]: 1 } : {}));
  const quantities = clampQuantities(buyable, picked);
  const items = cartItems(buyable, quantities);
  const itemsJson = JSON.stringify(items);
  const key = cartKey(items);
  const admissions = cartAdmissions(buyable, quantities);
  const selections = cartSelections(buyable, quantities);
  const currency = buyable[0]?.currency ?? "USD";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [express, setExpress] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const phase = useRef<"idle" | "wallet" | "paying">("idle");
  const idempotencyKey = useRef<string | null>(null);
  const attempt = useRef("");
  const detailsRef = useRef<HTMLDivElement>(null);
  const [detailsInView, setDetailsInView] = useState(false);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [promoDraft, setPromoDraft] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const quoteKey = `${key}|${promoCode ?? ""}`;
  const priced = quote?.key === quoteKey ? quote : null;
  const shownError = quoteError?.key === quoteKey ? quoteError.message : null;
  const localSubtotal = items.reduce((sum, item) => sum + (buyable.find((t) => t.id === item.ticket_type)?.priceCents ?? 0) * item.quantity, 0);
  const total = priced?.total ?? localSubtotal;

  // A cart of one ticket type is rebuilt from the single-ticket response, which has no lines.
  const only = items.length === 1 ? buyable.find((t) => t.id === items[0].ticket_type) : undefined;
  const singleJson = JSON.stringify(
    only ? ({ id: only.id, name: only.name, unitCents: only.priceCents, quantity: items[0].quantity, admits: admitsOf(only) } satisfies SingleTicket) : null,
  );

  useEffect(() => {
    if (items.length === 0 || quote?.key === quoteKey) return;
    let stale = false;
    const parsed = JSON.parse(itemsJson) as CartItem[];
    const single = JSON.parse(singleJson) as SingleTicket | null;
    // Wait for the guest to stop tapping so a run of changes is one quote.
    const timer = setTimeout(() => {
      fetch(functionUrl("checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(event.id, parsed, { quote: true, ...(promoCode ? { promoCode } : {}) })),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (stale) return;
          const rejected = promoRejectionMessage(res.status, body);
          if (rejected) {
            // The code no longer fits this cart. Drop it; the cart goes back to full price.
            setPromoCode(null);
            setPromoError(rejected);
            return;
          }
          const next = res.ok && body ? readQuote(quoteKey, body, single) : null;
          if (next) {
            setQuote(next);
            setQuoteError(null);
          } else if (!res.ok && body && typeof body.error === "string") {
            setQuoteError({ key: quoteKey, message: body.error });
          }
        })
        .catch(() => {});
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [event.id, itemsJson, singleJson, quoteKey, promoCode, quote?.key, items.length]);

  useEffect(() => {
    if (total > 0) elements?.update({ amount: total });
  }, [elements, total]);

  useEffect(() => {
    const node = detailsRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setDetailsInView(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (tiers.length === 0 || buyable.length === 0) return <SoldOutCard />;

  const totalLabel = exactMoney(total, currency);
  const valid = name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = items.length > 0 && !!priced;

  function change(tier: TicketTier, delta: 1 | -1) {
    if (busy) return;
    if (delta > 0 && !canIncrease(buyable, quantities, tier)) return;
    if (delta < 0 && !canDecrease(quantities, tier)) return;
    setError(null);
    setPicked({ ...quantities, [tier.id]: (quantities[tier.id] ?? 0) + delta });
  }

  async function applyPromo() {
    const entered = promoDraft.trim();
    if (!entered || promoBusy || busy) {
      if (!entered) setPromoError(PROMO_INVALID);
      return;
    }
    if (items.length === 0) {
      setPromoError("Add tickets, then apply your code.");
      return;
    }
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetch(functionUrl("checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(event.id, items, { quote: true, promoCode: entered })),
      });
      const body = await res.json().catch(() => ({}));
      const applied = res.ok && body?.promo?.code ? String(body.promo.code) : null;
      const single = only ? { id: only.id, name: only.name, unitCents: only.priceCents, quantity: items[0].quantity, admits: admitsOf(only) } : null;
      const next = applied ? readQuote(`${key}|${applied}`, body, single) : null;
      const rejected = promoRejectionMessage(res.status, body);
      if (applied && next) {
        setQuote(next);
        setPromoCode(applied);
        setPromoDraft(applied);
      } else if (rejected) {
        setPromoError(rejected);
      } else if (res.ok) {
        setPromoError(PROMO_INVALID);
      } else {
        setPromoError(typeof body?.error === "string" ? body.error : "Something went wrong. Please try again.");
      }
    } catch {
      setPromoError("Something went wrong. Please try again.");
    } finally {
      setPromoBusy(false);
    }
  }

  function removePromo() {
    if (busy) return;
    setPromoCode(null);
    setPromoDraft("");
    setPromoError(null);
  }

  function paymentKey(buyerEmail: string) {
    const next = `${key}|${promoCode ?? ""}|${buyerEmail.trim().toLowerCase()}`;
    if (attempt.current !== next || !idempotencyKey.current) {
      attempt.current = next;
      idempotencyKey.current = crypto.randomUUID();
    }
    return idempotencyKey.current;
  }

  async function releaseHold(holdKey: string) {
    await fetch(functionUrl("checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release: true, idempotencyKey: holdKey }),
    }).catch(() => {});
  }

  async function createIntent(buyer: { name: string; email: string }) {
    const res = await fetch(functionUrl("checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        requestBody(event.id, items, {
          idempotencyKey: paymentKey(buyer.email),
          ...(promoCode ? { promoCode } : {}),
          ...buyer,
        }),
      ),
    });
    const body = await res.json().catch(() => ({}));
    const rejected = promoRejectionMessage(res.status, body);
    if (rejected) {
      setPromoCode(null);
      setPromoError(rejected);
    }
    if (!res.ok || !body.clientSecret) throw new Error(body.error ?? "Something went wrong. Please try again.");
    return body as { clientSecret: string; paymentIntentId: string };
  }

  async function confirm(buyer: { name: string; email: string }) {
    if (!stripe || !elements) return;
    const { clientSecret, paymentIntentId } = await createIntent(buyer);
    const passes = `/tickets/?session=${paymentIntentId}`;
    const { error: payError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}${passes}`,
        payment_method_data: { billing_details: { name: buyer.name, email: buyer.email } },
      },
    });
    if (payError) throw new Error(payError.message ?? "Your payment didn't go through.");
    router.push(passes);
  }

  async function payByCard(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || phase.current !== "idle" || !priced) return;
    if (!valid) {
      setError("Add the name and email for your passes.");
      return;
    }
    if (!agreed) {
      setError("Confirm that ticket sales are final before you pay.");
      return;
    }
    phase.current = "paying";
    setBusy(true);
    onPayingChange(true);
    setError(null);
    const holdKey = paymentKey(email);
    try {
      const { error: fieldError } = await elements.submit();
      if (fieldError) throw new Error(fieldError.message);
      await confirm({ name: name.trim(), email: email.trim() });
    } catch (err) {
      await releaseHold(holdKey);
      idempotencyKey.current = null;
      phase.current = "idle";
      setError((err as Error).message);
      setBusy(false);
      onPayingChange(false);
    }
  }

  function onExpressClick(e: StripeExpressCheckoutElementClickEvent) {
    if (!agreed) {
      setError("Confirm that ticket sales are final before you pay.");
      e.reject();
      return;
    }
    if (!priced || phase.current !== "idle") {
      e.reject();
      return;
    }
    phase.current = "wallet";
    setError(null);
    e.resolve({
      emailRequired: true,
      lineItems: [
        ...priced.lines.map((line) => ({
          name: `${line.name} × ${line.quantity}${line.discount > 0 && priced.promo ? ` (${priced.promo.code} −${priced.promo.percent}%)` : ""}`,
          amount: line.discountedSubtotal,
        })),
        { name: "Sales tax", amount: priced.tax },
      ],
    });
  }

  function onExpressCancel() {
    if (phase.current === "wallet") phase.current = "idle";
  }

  async function onExpressConfirm(e: StripeExpressCheckoutElementConfirmEvent) {
    if (!elements || phase.current === "paying") {
      e.paymentFailed({ reason: "fail" });
      return;
    }
    phase.current = "paying";
    setBusy(true);
    onPayingChange(true);
    const buyerEmail = e.billingDetails?.email?.trim() || email.trim();
    const holdKey = paymentKey(buyerEmail);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      await confirm({
        name: e.billingDetails?.name?.trim() || name.trim() || "Guest",
        email: buyerEmail,
      });
    } catch (err) {
      await releaseHold(holdKey);
      idempotencyKey.current = null;
      phase.current = "idle";
      e.paymentFailed({ reason: "fail" });
      setError((err as Error).message);
      setBusy(false);
      onPayingChange(false);
    }
  }

  function continueToDetails() {
    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const field =
    "h-10 w-full rounded-[2px] border border-ivory/15 bg-white/[0.03] px-3 text-sm text-ivory placeholder:text-ivory/30 transition-colors hover:border-gold/40 focus:border-gold focus:outline-none";

  const label = "mb-1.5 block text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ivory/50";

  const atLimit = admissions >= MAX_CART_ADMISSIONS;
  const promoScope = priced?.promo ? promoScopeLabel(priced.promo.eligibleNames) : "";
  const lineFor = (id: string) => priced?.lines.find((line) => line.ticket_type === id);

  return (
    <form onSubmit={payByCard} noValidate className="relative flex min-w-0 flex-col">
      <div className="relative px-1 pt-2">
        <div className="grid items-start gap-5 lg:grid-cols-2 lg:gap-x-12">
          <div className="min-w-0">
            <p className="eyebrow text-ivory/45">Choose your tickets</p>
            <ul aria-label="Tickets" className="mt-2 divide-y divide-ivory/10 border-y border-ivory/10">
              {tiers.map((t) => {
                const gone = !!t.soldOut;
                const opensAfter = waitingFor(event, t);
                const unavailable = !gone && !!t.unavailable;
                const closed = gone || unavailable || !!opensAfter;
                const qty = quantities[t.id] ?? 0;
                const admits = admitsOf(t);
                return (
                  <li key={t.id} className={cn("flex items-center justify-between gap-3 py-2.5", closed && "opacity-60")}>
                    <div className="min-w-0">
                      <p className="break-words text-[0.7rem] font-semibold uppercase tracking-[0.16em]">{t.name}</p>
                      <p className="mt-0.5 text-[0.66rem] uppercase tracking-[0.12em] text-ivory/50">
                        <span className={cn("text-[0.95rem] normal-case tracking-normal text-ivory", gone && "text-ivory/35 line-through")}>
                          {exactMoney(t.priceCents, t.currency)}
                        </span>
                        <span className="ml-2">{admits > 1 ? `Admits ${admits}` : "Admits one"}</span>
                      </p>
                    </div>
                    {closed ? (
                      <span className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory/55">
                        {gone ? "Sold out" : unavailable ? "Unavailable" : `After ${opensAfter}`}
                      </span>
                    ) : (
                      <div role="group" aria-label={`${t.name} quantity`} className="flex shrink-0 items-center">
                        <Stepper
                          label={`Decrease ${t.name} quantity`}
                          disabled={!canDecrease(quantities, t) || busy}
                          onClick={() => change(t, -1)}
                        >
                          −
                        </Stepper>
                        <span aria-live="polite" aria-atomic="true" className="w-8 text-center font-display text-[1.35rem] leading-none tabular-nums">
                          {qty}
                        </span>
                        <Stepper
                          label={`Increase ${t.name} quantity`}
                          disabled={!canIncrease(buyable, quantities, t) || busy}
                          onClick={() => change(t, 1)}
                        >
                          +
                        </Stepper>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {atLimit && (
              <p className="mt-2 text-[0.68rem] text-ivory/50">Up to {MAX_CART_ADMISSIONS} admissions per booking.</p>
            )}

            <section aria-label="Your tickets" className="mt-5">
              <p className="eyebrow text-ivory/45">Your tickets</p>
              {items.length === 0 ? (
                <p className="mt-2 border-y border-ivory/10 py-4 text-[0.78rem] text-ivory/50">
                  Choose at least one ticket to continue.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-ivory/10 border-y border-ivory/10">
                  {items.map((item) => {
                    const t = buyable.find((tier) => tier.id === item.ticket_type)!;
                    const line = lineFor(item.ticket_type);
                    const lineTotal = line?.lineSubtotal ?? t.priceCents * item.quantity;
                    return (
                      <li key={item.ticket_type} className="flex items-start justify-between gap-3 py-2 text-[0.82rem]">
                        <span className="min-w-0 break-words">
                          {t.name} × {item.quantity}
                          {line && line.discount > 0 && priced?.promo && (
                            <span className="block text-[0.64rem] uppercase tracking-[0.12em] text-gold">
                              {priced.promo.code} −{priced.promo.percent}% · −{exactMoney(line.discount, currency)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">{exactMoney(lineTotal, currency)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3">
                {promoCode ? (
                  <div className="flex items-center justify-between gap-3">
                    <span aria-live="polite">
                      <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-gold">{promoCode} applied ✓</span>
                      <span className="mt-0.5 block text-[0.62rem] uppercase tracking-[0.16em] text-ivory/60">
                        {priced?.promo ? `${priced.promo.percent}% off ${promoScope}` : items.length ? "Updating…" : "Add tickets to apply"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={removePromo}
                      disabled={busy}
                      className="-my-2 -mr-2 min-h-11 px-2 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-ivory/55 underline-offset-4 transition-colors hover:text-ivory hover:underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="promo-code" className={label}>Promo code</label>
                    <div className="flex gap-2">
                      <input
                        id="promo-code"
                        className={cn(field, "min-w-0 uppercase placeholder:normal-case")}
                        value={promoDraft}
                        onChange={(e) => {
                          setPromoDraft(e.target.value);
                          if (promoError) setPromoError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void applyPromo();
                          }
                        }}
                        placeholder="Enter promo code"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={40}
                        disabled={busy || promoBusy}
                        aria-invalid={!!promoError}
                        aria-describedby={promoError ? "promo-error" : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => void applyPromo()}
                        disabled={busy || promoBusy || !promoDraft.trim()}
                        className="h-10 shrink-0 rounded-[2px] border border-gold/70 px-4 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-rich disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gold"
                      >
                        {promoBusy ? "…" : "Apply"}
                      </button>
                    </div>
                    {promoError && (
                      <p id="promo-error" role="alert" className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[#E7A598]">
                        {promoError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {shownError && (
                <p role="alert" className="mt-3 border border-[#E7A598]/40 px-3 py-2 text-[0.75rem] text-[#E7A598]">
                  {shownError}
                </p>
              )}

              {items.length > 0 && (
                <dl className="mt-3 space-y-1 text-[0.72rem] text-ivory/60">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="eyebrow text-ivory/45">Original subtotal</dt>
                    <dd className="tabular-nums">{exactMoney(priced?.subtotal ?? localSubtotal, currency)}</dd>
                  </div>
                  {priced?.promo && priced.discount > 0 && (
                    <>
                      <div className="flex items-start justify-between gap-3 text-gold">
                        <dt className="min-w-0">
                          <span className="eyebrow block">Eligible ticket discount</span>
                          <span className="block text-[0.6rem] uppercase tracking-[0.12em] opacity-80">
                            {priced.promo.code} · {priced.promo.percent}% off {promoScope}
                          </span>
                        </dt>
                        <dd className="shrink-0 tabular-nums">−{exactMoney(priced.discount, currency)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="eyebrow text-ivory/45">Discounted subtotal</dt>
                        <dd className="tabular-nums">{exactMoney(priced.discountedSubtotal, currency)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="eyebrow text-ivory/45">Sales tax</dt>
                    <dd className="tabular-nums">{priced ? exactMoney(priced.tax, currency) : "Calculating…"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-ivory/10 pt-2 text-[0.8rem] text-ivory">
                    <dt className="eyebrow text-ivory/70">Total</dt>
                    <dd className="font-display text-[1.25rem] leading-none tabular-nums">{priced ? exactMoney(priced.total, currency) : "—"}</dd>
                  </div>
                </dl>
              )}
            </section>
          </div>

          <div ref={detailsRef} className="min-w-0 scroll-mt-4 lg:border-l lg:border-ivory/10 lg:pl-10">
            <div className={cn(express && "mb-3")}>
              <ExpressCheckoutElement
                onReady={({ availablePaymentMethods }) =>
                  setExpress(!!(availablePaymentMethods?.applePay || availablePaymentMethods?.googlePay))
                }
                onClick={onExpressClick}
                onConfirm={onExpressConfirm}
                onCancel={onExpressCancel}
                options={{
                  buttonType: { applePay: "book", googlePay: "book" },
                  buttonTheme: { applePay: "white", googlePay: "white" },
                  buttonHeight: 44,
                  paymentMethods: {
                    applePay: "always",
                    googlePay: "always",
                    link: "never",
                    amazonPay: "never",
                    paypal: "never",
                    klarna: "never",
                  },
                }}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className={label}>Full name</span>
                <input className={field} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your ID" />
              </label>
              <label className="block">
                <span className={label}>Email</span>
                <input
                  className={field}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Passes are sent here"
                />
              </label>
            </div>

            <div className="mt-2">
              <PaymentElement
                options={{
                  layout: "tabs",
                  wallets: { applePay: "auto", googlePay: "auto", link: "never" },
                  fields: { billingDetails: { name: "never", email: "never", address: "if_required" } },
                  terms: { card: "never" },
                }}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 border border-[#E7A598]/40 px-3 py-2 text-[0.75rem] text-[#E7A598]">
                {error}
              </p>
            )}

            <div className="mt-4">
              <button
                type="submit"
                disabled={!stripe || busy || !ready || !agreed}
                className="h-12 w-full rounded-[2px] bg-gold text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-rich transition-colors duration-500 hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Securing your passes…" : items.length === 0 ? "Choose tickets to continue" : `Book · ${totalLabel}`}
              </button>
              <PolicyAck agreed={agreed} onChange={setAgreed} />
            </div>
          </div>
        </div>
      </div>

      {items.length > 0 && !detailsInView && (
        <div
          role="region"
          aria-label="Cart summary"
          className="sticky bottom-0 z-20 -mx-5 mt-4 border-t border-gold/30 bg-rich/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:hidden"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[0.66rem] uppercase leading-snug tracking-[0.1em] text-ivory/65" aria-live="polite">
              <span className="block">
                {selections} {selections === 1 ? "selection" : "selections"} · {admissions} total {admissions === 1 ? "admission" : "admissions"}
              </span>
              <span className="mt-0.5 block font-display text-[1.3rem] normal-case leading-none tracking-normal text-ivory tabular-nums">
                {priced ? exactMoney(priced.total, currency) : exactMoney(localSubtotal, currency)}
                {!priced && <span className="ml-1 text-[0.62rem] uppercase tracking-[0.12em] text-ivory/45">+ tax</span>}
              </span>
            </p>
            <button
              type="button"
              onClick={continueToDetails}
              className="h-11 shrink-0 rounded-[2px] bg-gold px-5 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-rich transition-colors hover:bg-gold-soft"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function Stepper({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center text-xl text-ivory transition-colors duration-300 hover:text-gold disabled:opacity-30"
    >
      <span aria-hidden className="flex size-8 items-center justify-center rounded-full border border-ivory/25">
        {children}
      </span>
    </button>
  );
}

function SoldOutCard() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-[2.4rem] leading-none text-ivory">
        Sold <span className="italic text-gold">out.</span>
      </p>
      <p className="mt-4 text-sm text-ivory/55">Every pass for this night has been claimed.</p>
    </div>
  );
}

function Closed({ event, phase }: { event: OneMoreEvent | null; phase: SalesPhase | null }) {
  const ended = phase === "ended";
  if (event?.status === "sold-out" || phase === "closed") return <SoldOutCard />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
      <p className="font-display text-[clamp(2.2rem,8vw,3.2rem)] leading-none text-ivory">
        {ended && event ? (
          event.name
        ) : event ? (
          <>
            {event.name} <span className="italic text-gold">— soon.</span>
          </>
        ) : (
          "Nothing to book here."
        )}
      </p>
      <p className="mt-5 max-w-[34ch] text-sm leading-relaxed text-ivory/55">
        {ended ? "This night has ended." : event ? "Passes aren't on sale yet. Check back shortly." : "This checkout link isn't valid."}
      </p>
      <Link
        href="/"
        className="mt-10 border border-gold/70 px-8 py-3.5 text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold hover:text-rich"
      >
        Return home
      </Link>
    </div>
  );
}
