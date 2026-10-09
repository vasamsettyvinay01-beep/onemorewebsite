# Stripe integration — remaining setup

The embedded Checkout form charges the selected pass from the `tiers` table and sends the guest details the webhook needs to email the pass.

## Values to Replace

No placeholder prices remain. `line_items` uses `price_data.unit_amount` from the selected tier (`price_cents`), and `mode` is `payment` because a pass is a one-time charge.

`payment_method_collection` is not sent while `mode` is `payment`. If you change `mode` to `subscription`, add `payment_method_collection: "always"`.

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**

- [supabase/functions/create-checkout-session/index.ts](supabase/functions/create-checkout-session/index.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | form |
| mode | payment |
| billing_address_collection | auto |
| phone_number_collection | { "enabled": false } |
| automatic_tax | { "enabled": false } |
| submit_type | auto |
| integration_identifier | custom_embedded_web_0001 |

`ui_mode` is `form` because this function imports `stripe@23` (21.0.0 or newer). If you pin Stripe below 21.0.0, change `ui_mode` to `custom`.

The form appearance is set in [src/components/checkout/CheckoutForm.tsx](src/components/checkout/CheckoutForm.tsx).

## Setup and next steps

### Environment variables

| Variable | Where it lives | Used by |
|----------|----------------|---------|
| `STRIPE_SECRET_KEY` | Supabase secret | `create-checkout-session` |
| Publishable key | `stripeKey` in [src/data/backend.ts](src/data/backend.ts) | Checkout form in the browser |
| `STRIPE_WEBHOOK_SECRET` | Supabase secret | Existing `stripe-webhook` function |

The browser key in `backend.ts` is a live key (`pk_live_`). A successful payment charges a real card.

### Deploy

`create-checkout-session` is deployed on project `curprrfrkefegefqiign`. Redeploy after any later edit:

```bash
npx supabase functions deploy create-checkout-session --use-api
```

`verify_jwt` is `false` for this function in [supabase/config.toml](supabase/config.toml).

### How a purchase works

1. The guest picks a pass, quantity, name, and email.
2. The page POSTs those to `create-checkout-session`.
3. The function checks capacity, charges `price_cents × quantity`, and stores the booking on the Checkout Session.
4. The embedded form confirms the payment, then the browser opens `/tickets/?session=cs_…`.
5. `checkout.session.completed` creates the order and emails the passes. `payment_intent.succeeded` is skipped for these payments (`omc_source` is `embedded`) so the pass is not emailed twice.

### Testing

Use a real card only if you mean to buy a pass. Test card `4242 4242 4242 4242` works only with test keys.

### Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
