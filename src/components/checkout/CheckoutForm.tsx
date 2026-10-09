"use client";

import { useEffect, useState } from "react";
import { backend, functionUrl } from "@/data/backend";

const appearance = {
  theme: "stripe",
  labels: "auto",
  inputs: "spaced",
  variables: {
    borderRadius: "4px",
    colorBackground: "#ffffff",
    colorDanger: "#df1b41",
    colorPrimary: "#0570de",
    colorSuccess: "#00c853",
    colorText: "#30313d",
    fontFamily: "default",
    fontSizeBase: "16px",
    spacingUnit: "4px",
  },
} as const;

type FormHandle = {
  mount: (selector: string) => void;
  on: (event: "confirm", handler: (event: unknown) => void) => void;
};

type CheckoutFormSdk = {
  createForm: (options: { layout: "expanded" }) => FormHandle;
  loadActions: () => Promise<
    | { type: "success"; actions: { confirm: (args: { formConfirmEvent: unknown }) => Promise<unknown> } }
    | { type: string }
  >;
};

type StripeCheckout = (key: string, options: { betas: string[] }) => {
  initCheckoutFormSdk: (options: { clientSecret: Promise<string>; appearance: typeof appearance }) => CheckoutFormSdk;
};

declare global {
  interface Window {
    Stripe?: StripeCheckout;
  }
}

type Booking = {
  eventId: string;
  tierId: string;
  quantity: number;
  name: string;
  email: string;
};

export function CheckoutForm({ eventId, tierId, quantity, name, email }: Booking) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!backend.stripeKey) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void start();
    }, 400);

    async function start() {
      setError(null);
      setReady(false);
      const Stripe = await waitForStripe();
      if (cancelled) return;

      const stripe = Stripe(backend.stripeKey, { betas: ["custom_checkout_payment_form_1"] });
      let secret: string;
      try {
        const response = await fetch(functionUrl("create-checkout-session"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, tierId, quantity, name, email, origin: window.location.origin }),
        });
        const json = (await response.json().catch(() => ({}))) as { client_secret?: string; error?: string };
        if (!response.ok || !json.client_secret) {
          throw new Error(json.error ?? "Could not start checkout.");
        }
        secret = json.client_secret;
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
        return;
      }
      if (cancelled) return;

      const checkout = stripe.initCheckoutFormSdk({ clientSecret: Promise.resolve(secret), appearance });
      const form = checkout.createForm({ layout: "expanded" });
      form.mount("#checkout-form");
      setReady(true);

      const loadActionsResult = await checkout.loadActions();
      if (cancelled) return;
      if (loadActionsResult.type !== "success") {
        setError("Payment form didn't load. Please try again.");
        return;
      }
      const sessionId = secret.split("_secret_")[0];
      form.on("confirm", async (event) => {
        try {
          await loadActionsResult.actions.confirm({ formConfirmEvent: event });
          if (sessionId.startsWith("cs_")) window.location.assign(`/tickets/?session=${sessionId}`);
        } catch (confirmError) {
          console.error("Payment confirmation error:", confirmError);
        }
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.getElementById("checkout-form")?.replaceChildren();
    };
  }, [eventId, tierId, quantity, name, email]);

  return (
    <div className="mt-2">
      {!ready && !error && <p className="text-[0.75rem] text-ivory/50">Preparing payment…</p>}
      <div id="checkout-form" />
      {error && (
        <p role="alert" className="mt-3 border border-[#E7A598]/40 px-3 py-2 text-[0.75rem] text-[#E7A598]">
          {error}
        </p>
      )}
    </div>
  );
}

function waitForStripe(): Promise<StripeCheckout> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.Stripe) resolve(window.Stripe);
      else if (Date.now() - started > 10000) reject(new Error("Stripe.js did not load."));
      else window.setTimeout(tick, 50);
    };
    tick();
  });
}
