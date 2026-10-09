"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe, type Appearance, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeExpressCheckoutElementClickEvent, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { brand } from "@/data/brand";
import { backend, backendConfigured, functionUrl } from "@/data/backend";
import { useLiveEvent } from "@/lib/availability";
import { formatChapter, formatEventTime, formatMoney, getEventBySlug, getVisibleTiers, isOnSale } from "@/lib/events";
import { cn } from "@/lib/cn";
import type { OneMoreEvent, TicketTier } from "@/types/event";

const stripePromise = backend.stripeKey ? loadStripe(backend.stripeKey) : null;

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
  if (!event.date) return undefined;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(`${event.date}T12:00:00`),
  );
}

export function CheckoutView() {
  const params = useSearchParams();
  const staticEvent = getEventBySlug(params.get("event") ?? "") ?? null;
  const event = useLiveEvent(staticEvent, true);
  const open = !!event && backendConfigured && !!stripePromise && isOnSale(event);

  const date = event ? longDate(event) : undefined;
  const when = [date?.replace(/, \d{4}$/, ""), event ? formatEventTime(event) : undefined].filter(Boolean).join(" · ");

  return (
    <main className="fixed inset-0 overflow-y-auto bg-rich text-ivory">
      <div
        className={cn(
          "mx-auto flex min-h-full w-full items-center px-5 py-4 sm:px-8",
          params.get("tier") ? "max-w-xl" : "max-w-5xl",
        )}
      >
        <div className="flex w-full flex-col">
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
                <CheckoutCard event={event} initialTier={params.get("tier")} />
              </Elements>
            </div>
          ) : (
            <Closed event={event} />
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

function CheckoutCard({ event, initialTier }: { event: OneMoreEvent; initialTier: string | null }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const tiers = getVisibleTiers(event).filter((t) => !t.priceOnRequest);
  const buyable = tiers.filter((t) => !t.soldOut);
  const chosen = buyable.find((t) => t.id === initialTier);
  const [tierId, setTierId] = useState(chosen?.id ?? "");
  const tier: TicketTier | undefined = chosen ?? buyable.find((t) => t.id === tierId) ?? [...buyable].sort((a, b) => a.priceCents - b.priceCents)[0];
  const locked = !!chosen;
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [express, setExpress] = useState(true);

  const maxQty = Math.min(tier?.maxPerOrder ?? 10, 10);
  const qty = Math.min(quantity, maxQty);
  const total = (tier?.priceCents ?? 0) * qty;

  useEffect(() => {
    if (total > 0) elements?.update({ amount: total });
  }, [elements, total]);

  if (!tier) return <SoldOutCard />;

  const admits = (tier.admits ?? 1) * qty;
  const totalLabel = formatMoney(total, tier.currency);
  const valid = name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function createIntent(buyer: { name: string; email: string }) {
    const res = await fetch(functionUrl("checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: event.id, tierId: tier!.id, quantity: qty, ...buyer }),
    });
    const body = await res.json().catch(() => ({}));
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
    if (!stripe || !elements || busy) return;
    if (!valid) {
      setError("Add the name and email for your passes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: fieldError } = await elements.submit();
      if (fieldError) throw new Error(fieldError.message);
      await confirm({ name: name.trim(), email: email.trim() });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function onExpressClick(e: StripeExpressCheckoutElementClickEvent) {
    setError(null);
    e.resolve({
      emailRequired: true,
      lineItems: [{ name: `${event.name} · ${tier!.name} × ${qty}`, amount: total }],
    });
  }

  async function onExpressConfirm(e: StripeExpressCheckoutElementConfirmEvent) {
    if (!elements) return;
    setBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      await confirm({
        name: e.billingDetails?.name?.trim() || name.trim() || "Guest",
        email: e.billingDetails?.email?.trim() || email.trim(),
      });
    } catch (err) {
      e.paymentFailed({ reason: "fail" });
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const field =
    "h-10 w-full rounded-[2px] border border-ivory/15 bg-white/[0.03] px-3 text-sm text-ivory placeholder:text-ivory/30 transition-colors hover:border-gold/40 focus:border-gold focus:outline-none";

  const label = "mb-1.5 block text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ivory/50";

  return (
    <form onSubmit={payByCard} noValidate className="relative flex flex-col">
      <div className="relative px-1 pt-2">
        <div className={cn("grid items-start gap-4", !locked && "lg:grid-cols-2 lg:gap-x-12")}>
          <div>
            {locked ? (
              <div className="flex items-end justify-between gap-4 border-y border-ivory/10 py-3">
                <span>
                  <span className="eyebrow text-ivory/45">Your pass</span>
                  <span className="mt-1 block text-sm uppercase tracking-[0.18em]">{tier.name}</span>
                  <span className="mt-0.5 block text-[0.68rem] text-ivory/45">
                    {(tier.admits ?? 1) > 1 ? `Admits ${tier.admits}` : "Admits one"}
                  </span>
                </span>
                <span className="font-display text-[1.7rem] leading-none">{formatMoney(tier.priceCents, tier.currency)}</span>
              </div>
            ) : (
            <div role="radiogroup" aria-label="Admission" className="divide-y divide-ivory/10 border-y border-ivory/10">
              {tiers.map((t) => {
                const selected = t.id === tier.id;
                const gone = !!t.soldOut;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={gone || busy}
                    onClick={() => setTierId(t.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition-colors sm:py-2.5",
                      selected ? "bg-gold/10" : "hover:bg-white/[0.03]",
                      gone && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                          selected ? "border-gold" : "border-ivory/25",
                        )}
                      >
                        {selected && <span className="size-1.5 rounded-full bg-gold" />}
                      </span>
                      <span className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.16em] sm:text-[0.68rem]">
                        {t.name}
                        <span className="ml-2 font-normal tracking-[0.12em] text-ivory/40">
                          {gone ? "Sold out" : (t.admits ?? 1) > 1 ? `Admits ${t.admits}` : "Admits one"}
                        </span>
                      </span>
                    </span>
                    <span className={cn("shrink-0 font-display text-[1.15rem] leading-none sm:text-[1.25rem]", gone && "text-ivory/35 line-through")}>
                      {formatMoney(t.priceCents, t.currency)}
                    </span>
                  </button>
                );
              })}
            </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              <span>
                <span className="eyebrow text-ivory/45">Quantity</span>
                <span className="mt-0.5 block text-[0.72rem] text-ivory/50">
                  {admits} {admits === 1 ? "guest" : "guests"}
                </span>
              </span>
              <div className="flex items-center gap-3">
                <Stepper label="Fewer" disabled={qty <= 1 || busy} onClick={() => setQuantity(Math.max(1, qty - 1))}>
                  −
                </Stepper>
                <span aria-live="polite" className="w-5 text-center font-display text-[1.35rem] leading-none">
                  {qty}
                </span>
                <Stepper label="More" disabled={qty >= maxQty || busy} onClick={() => setQuantity(Math.min(maxQty, qty + 1))}>
                  +
                </Stepper>
              </div>
            </div>
          </div>

          <div className={cn(!locked && "lg:border-l lg:border-ivory/10 lg:pl-10")}>
            <div className={cn(express && "mb-3")}>
              <ExpressCheckoutElement
                onReady={({ availablePaymentMethods }) =>
                  setExpress(!!(availablePaymentMethods?.applePay || availablePaymentMethods?.googlePay))
                }
                onClick={onExpressClick}
                onConfirm={onExpressConfirm}
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
                  fields: { billingDetails: { name: "never", email: "never", address: "never" } },
                  terms: { card: "never" },
                }}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 border border-[#E7A598]/40 px-3 py-2 text-[0.75rem] text-[#E7A598]">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={cn("relative shrink-0 px-1 pt-2", !locked && "grid gap-4 lg:grid-cols-2 lg:gap-x-12")}>
        {!locked && <div className="hidden lg:block" />}
        <div className={cn(!locked && "lg:pl-10")}>
          <button
            type="submit"
            disabled={!stripe || busy}
            className="h-12 w-full rounded-[2px] bg-gold text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-rich transition-colors duration-500 hover:bg-gold-soft disabled:cursor-wait disabled:opacity-50"
          >
            {busy ? "Securing your passes…" : `Book · ${totalLabel}`}
          </button>
        </div>
      </div>

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
      className="flex size-8 items-center justify-center rounded-full border border-ivory/20 text-base text-ivory transition-colors duration-500 hover:border-gold disabled:opacity-30"
    >
      {children}
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

function Closed({ event }: { event: OneMoreEvent | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
      <p className="font-display text-[clamp(2.2rem,8vw,3.2rem)] leading-none text-ivory">
        {event ? (
          <>
            {event.name} <span className="italic text-gold">— soon.</span>
          </>
        ) : (
          "Nothing to book here."
        )}
      </p>
      <p className="mt-5 max-w-[34ch] text-sm leading-relaxed text-ivory/55">
        {event ? "Passes aren't on sale yet. Check back shortly." : "This checkout link isn't valid."}
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
