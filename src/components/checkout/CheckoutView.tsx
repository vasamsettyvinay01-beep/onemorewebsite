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
const INK = "#0B0B0A";

const appearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: GOLD,
    colorBackground: "#121210",
    colorText: "#ECEAE4",
    colorTextSecondary: "rgba(236,234,228,0.5)",
    colorTextPlaceholder: "rgba(236,234,228,0.26)",
    colorDanger: "#E58A6E",
    colorIcon: "rgba(236,234,228,0.5)",
    fontFamily: "Manrope, 'Helvetica Neue', Arial, sans-serif",
    fontSizeBase: "13px",
    borderRadius: "3px",
    spacingUnit: "2px",
    gridRowSpacing: "8px",
  },
  rules: {
    ".Input": {
      backgroundColor: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(187,155,99,0.22)",
      boxShadow: "none",
      padding: "8px 10px",
    },
    ".Input:hover": { border: "1px solid rgba(187,155,99,0.4)" },
    ".Input:focus": { border: `1px solid ${GOLD}`, boxShadow: "0 0 0 3px rgba(187,155,99,0.14)" },
    ".Input--invalid": { border: "1px solid #E58A6E", boxShadow: "none" },
    ".Label": {
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.24em",
      textTransform: "uppercase",
      color: "rgba(236,234,228,0.45)",
      marginBottom: "4px",
    },
    ".Tab": { border: "1px solid rgba(187,155,99,0.22)", boxShadow: "none" },
    ".Tab--selected": { border: `1px solid ${GOLD}`, color: "#ECEAE4" },
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
  const art = event?.checkoutArtwork ?? event?.ticketArtwork ?? event?.artwork;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#070706] text-ivory">
      {art?.src && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] lg:inset-0 lg:h-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} alt="" className="size-full object-cover object-[86%_50%] lg:object-[70%_50%]" />
          <div className="absolute inset-0 bg-linear-to-b from-[#070706]/10 via-[#070706]/55 to-[#070706] lg:bg-linear-to-r lg:from-[#070706]/80 lg:via-[#070706]/20 lg:to-[#070706]/40" />
          <div className="absolute inset-0 hidden bg-linear-to-t from-[#070706] via-transparent to-[#070706]/40 lg:block" />
        </div>
      )}

      <div className="relative mx-auto flex h-full max-w-[78rem] flex-col px-4 sm:px-6 lg:px-10">
        <TopBar />
        {event && open ? (
          <div className="grid min-h-0 flex-1 content-center items-center gap-3 pb-3 pt-1 lg:grid-cols-[minmax(0,1fr)_25.5rem] lg:gap-12 lg:pb-4">
            <EventIntro event={event} />
            <Elements stripe={stripePromise} options={elementsOptions(1)}>
              <CheckoutCard event={event} initialTier={params.get("tier")} />
            </Elements>
          </div>
        ) : (
          <Closed event={event} />
        )}
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

function TopBar() {
  return (
    <header className="relative z-10 flex shrink-0 items-center justify-between pt-3 lg:pt-4">
      <Link href="/" className="group flex items-center gap-3" aria-label={`${brand.name} — home`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.sealPath} alt="" width={32} height={32} className="size-8" />
        <span className="hidden text-[0.56rem] font-semibold uppercase tracking-[0.42em] text-gold sm:block">{brand.name}</span>
      </Link>
      <span className="flex items-center gap-2 text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-ivory/55">
        <LockIcon />
        Secure checkout
      </span>
    </header>
  );
}

function EventIntro({ event }: { event: OneMoreEvent }) {
  const date = longDate(event);
  const time = formatEventTime(event);
  const venue = event.venue;
  return (
    <section className="lg:max-w-[32rem]">
      <p className="text-[0.55rem] font-semibold uppercase tracking-[0.38em] text-gold">
        {event.chapter !== undefined ? formatChapter(event.chapter) : "One More"}
        {event.city ? ` · ${event.city}` : ""}
      </p>
      <h1 className="mt-2 bg-[linear-gradient(176deg,#FFF4D6_0%,#E9D3A1_28%,#C9A96E_52%,#8E6E3F_78%,#D8C196_100%)] bg-clip-text font-display text-[clamp(2.35rem,4.6vw,4.75rem)] leading-[0.88] tracking-[-0.02em] text-transparent">
        {event.name}
      </h1>
      <p className="mt-2 truncate text-[0.72rem] text-ivory/70 lg:hidden">{[date, time, venue?.name].filter(Boolean).join(" · ")}</p>
      <dl className="mt-5 hidden grid-cols-2 gap-x-8 border-t border-gold/20 sm:max-w-[28rem] lg:grid">
        <Fact label="Date" value={date ?? "TBA"} />
        <Fact label="Time" value={time ?? "TBA"} />
        <Fact label="Venue" value={venue?.name ?? event.city ?? "TBA"} />
        <Fact label="Entry" value={event.minimumAge ? `${event.minimumAge}+` : "All welcome"} />
      </dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-gold/12 py-2.5">
      <dt className="text-[0.5rem] font-semibold uppercase tracking-[0.32em] text-ivory/40">{label}</dt>
      <dd className="mt-1 font-display text-[1.05rem] leading-none text-ivory">{value}</dd>
    </div>
  );
}

function CheckoutCard({ event, initialTier }: { event: OneMoreEvent; initialTier: string | null }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const tiers = getVisibleTiers(event).filter((t) => !t.priceOnRequest);
  const buyable = tiers.filter((t) => !t.soldOut);
  const [tierId, setTierId] = useState(initialTier ?? "");
  const tier: TicketTier | undefined =
    buyable.find((t) => t.id === tierId) ?? [...buyable].sort((a, b) => a.priceCents - b.priceCents)[0];
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [express, setExpress] = useState(false);

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
    "h-9 w-full rounded-[3px] border border-gold/22 bg-white/[0.025] px-2.5 text-[13px] text-ivory placeholder:text-ivory/25 transition-[border-color,box-shadow] hover:border-gold/40 focus:border-gold focus:shadow-[0_0_0_3px_rgba(187,155,99,0.14)] focus:outline-none";

  return (
    <form
      onSubmit={payByCard}
      noValidate
      className="relative overflow-hidden rounded-[6px] border border-gold/25 bg-[#0C0C0B]/72 shadow-[0_70px_140px_-50px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-2xl"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(140deg,rgba(255,244,214,0.09)_0%,transparent_32%,transparent_70%,rgba(187,155,99,0.07)_100%)]"
      />
      <div aria-hidden className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-gold to-transparent" />

      <div className="relative px-4 pb-4 pt-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-[1.35rem] leading-none text-ivory">Reserve your pass</p>
          <p className="shrink-0 text-[0.48rem] font-semibold uppercase tracking-[0.28em] text-gold/80">{event.name}</p>
        </div>

        <div role="radiogroup" aria-label="Admission" className="mt-3 flex flex-col gap-1.5">
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
                  "flex items-center justify-between gap-3 rounded-[3px] border px-3 py-2 text-left transition-[border-color,background-color]",
                  selected
                    ? "border-gold/80 bg-[linear-gradient(120deg,rgba(187,155,99,0.16),rgba(187,155,99,0.04))]"
                    : "border-ivory/10 bg-white/[0.015] hover:border-gold/40",
                  gone && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn("flex size-3.5 items-center justify-center rounded-full border", selected ? "border-gold" : "border-ivory/25")}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-gold" />}
                  </span>
                  <span>
                    <span className="block text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-ivory">{t.name}</span>
                    <span className="mt-0.5 block text-[0.6rem] text-ivory/45">
                      {gone ? "Sold out" : (t.admits ?? 1) > 1 ? `Admits ${t.admits}` : "Admits one"}
                    </span>
                  </span>
                </span>
                <span className={cn("font-display text-[1.15rem] leading-none", gone ? "text-ivory/40 line-through" : "text-ivory")}>
                  {formatMoney(t.priceCents, t.currency)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between rounded-[3px] border border-ivory/10 px-3 py-1.5">
          <span>
            <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-ivory/50">Quantity</span>
            <span className="mt-0.5 block text-[0.62rem] text-ivory/40">
              {admits} {admits === 1 ? "guest" : "guests"}
            </span>
          </span>
          <div className="flex items-center gap-3">
            <Stepper label="Fewer" disabled={qty <= 1 || busy} onClick={() => setQuantity(Math.max(1, qty - 1))}>
              −
            </Stepper>
            <span aria-live="polite" className="w-4 text-center font-display text-[1.25rem] leading-none">
              {qty}
            </span>
            <Stepper label="More" disabled={qty >= maxQty || busy} onClick={() => setQuantity(Math.min(maxQty, qty + 1))}>
              +
            </Stepper>
          </div>
        </div>

        <div className={cn(express ? "mt-3" : "hidden")}>
          <ExpressCheckoutElement
            onReady={({ availablePaymentMethods }) => setExpress(!!availablePaymentMethods)}
            onClick={onExpressClick}
            onConfirm={onExpressConfirm}
            options={{
              buttonType: { applePay: "book", googlePay: "book" },
              buttonTheme: { applePay: "white", googlePay: "white" },
              buttonHeight: 40,
              paymentMethods: { link: "never", amazonPay: "never", paypal: "never", klarna: "never" },
            }}
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.24em] text-ivory/45">Full name</span>
            <input className={field} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your ID" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.24em] text-ivory/45">Email</span>
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

        <div className="mt-3">
          <PaymentElement
            options={{
              layout: "tabs",
              wallets: { applePay: "never", googlePay: "never", link: "never" },
              fields: { billingDetails: { name: "never", email: "never", address: "never" } },
              terms: { card: "never" },
            }}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-[3px] border border-[#E58A6E]/40 px-3 py-2 text-[0.75rem] text-[#F0B4A2]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!stripe || busy}
          className="group relative mt-3 h-11 w-full overflow-hidden rounded-[3px] bg-[linear-gradient(180deg,#F1DFB4_0%,#D2B47A_42%,#B08E55_70%,#C9A96E_100%)] text-[0.64rem] font-bold uppercase tracking-[0.32em] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-1px_0_rgba(0,0,0,0.25),0_18px_44px_-14px_rgba(187,155,99,0.65)] transition-[filter,transform] duration-300 hover:brightness-[1.06] active:translate-y-px disabled:cursor-wait disabled:opacity-70"
          style={{ color: INK }}
        >
          <span className="relative">{busy ? "Securing your passes…" : `Book · ${totalLabel}`}</span>
        </button>
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
      className="flex size-7 items-center justify-center rounded-full border border-gold/30 text-base text-ivory transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function SoldOutCard() {
  return (
    <div className="rounded-[6px] border border-gold/25 bg-[#0C0C0B]/72 px-8 py-12 text-center backdrop-blur-2xl">
      <p className="font-display text-[2.4rem] leading-none">
        Sold <span className="italic text-gold">out.</span>
      </p>
      <p className="mt-4 text-sm text-ivory/55">Every pass for this night has been claimed.</p>
    </div>
  );
}

function Closed({ event }: { event: OneMoreEvent | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
      <p className="font-display text-[clamp(2.6rem,8vw,4rem)] leading-none text-ivory">
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

function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3 fill-none stroke-current" strokeWidth="1.4">
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
