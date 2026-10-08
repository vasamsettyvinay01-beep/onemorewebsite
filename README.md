# The One More Company — Website

One continuous, cinematic public page for The One More Company.
Events are temporary campaigns that plug into the permanent brand system through data.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

```bash
npm run lint       # eslint
npx tsc --noEmit   # type check
npm run build      # production build
npm start          # serve the production build
```

Node 20+ is required.

## Add the official logo

Drop the production SVG at:

```
public/brand/logo/one-more-production-master.svg
```

Nothing else is needed. Every logo instance (header, hero, closing, background
emblem geometry) reads this one file. Until it exists the site renders a clearly
labelled "LOGO PENDING" slot and logs a warning on every build.

If the SVG is not square, update `brand.logo.aspectRatio` in `src/data/brand.ts`.

## Where things live

| What | File |
| --- | --- |
| Brand name, colours, copy, logo path | `src/data/brand.ts` |
| WhatsApp / Instagram / Facebook / email | `src/data/socials.ts` |
| Section anchors + header navigation | `src/data/navigation.ts` |
| Event lineup (featured event, theme, tiers) | `src/data/events.ts` |
| Vibe frames (PEOPLE / ENERGY / CULTURE / MOMENTS) | `src/data/vibe.ts` |
| Campaign wall pieces | `src/data/campaign.ts` |
| Event / ticket / order / check-in types | `src/types/` |
| Checkout provider abstraction | `src/lib/checkout.ts` |

```
src/
  app/            layout, page, global CSS (tokens, grain, utilities)
  components/
    layout/       Header, MenuPanel
    canvas/       OneMoreCanvas (parent layer), CanvasProvider (scroll progress + takeover),
                  CanvasAtmosphere (the one persistent world behind everything)
      movements/  Arrival, Statements, Interventions (PEOPLE/ENERGY, CULTURE/MOMENTS),
                  Experience → ExperienceTakeover (campaign takeover), Gathering, Closing, Poster
    events/       EventFacts (COMING SOON facts, never invented)
    ticketing/    TicketSheetProvider, TicketSheet, states/ (ComingSoon, Checkout, Confirmation, SoldOut)
    community/    CommunityProvider, CommunityPanel, FloatingCommunityPill, SocialGlyph
    motion/       Reveal, Parallax, PointerLight, MotionProvider
    ui/           Grain, ArtworkFrame, BrandLogo, EmblemGhost, Dialog, Button
  data/           centralised configuration
  lib/            helpers (events, theme → CSS vars, checkout, motion)
  types/          domain contracts
  fonts/          self-hosted OFL fonts (Cormorant Garamond, Montserrat)
public/
  brand/logo/     official SVG goes here
  events/<slug>/  campaign artwork per event
  vibe/           photography for the Vibe frames
  campaign/       poster / campaign wall assets
```

## Publish a new experience

1. Add an object to `src/data/events.ts` (see the commented example there).
2. Put campaign artwork in `public/events/<slug>/` and set `artwork.src`.
3. Define `theme` — the section, lights, CTA and ticket sheet all recolour from it.
4. Fill only the details that are confirmed; anything undefined shows **COMING SOON**.
5. Set `featured: true` (and `false` on the previous event).

Status values: `draft` · `coming-soon` · `on-sale` · `sold-out` · `past` · `cancelled`.

## Ticketing

`GET TICKETS` opens a bottom sheet (mobile) / modal (desktop) over the dimmed artwork.
The sheet picks its state from event status and the `CheckoutProvider`:

- `coming-soon` → Tickets coming soon + Join WhatsApp
- `sold-out` → Sold out + Join WhatsApp
- `on-sale` with a live provider → quantity → name → email → Apple Pay / Google Pay / Pay
- `on-sale` without a live provider → coming-soon state (never a fake checkout)

The site is a static export, so the ticketing backend lives in a dedicated Supabase
project (`supabase/`) and payments run through Stripe Payment Links.

```
GET TICKETS → Stripe Payment Link → pays → redirected to /tickets/?session=…
                                     └→ Stripe webhook → supabase/functions/stripe-webhook
                                          creates the order + one ticket per guest,
                                          emails QR codes (Resend), closes capped tiers
/tickets/?o=<link token>  → QR per guest (supabase/functions/ticket-view)
/door                     → shared staff login, camera scanner, guest list (supabase/functions/door)
```

- A QR contains only a random 36-char token. Names and emails are never in the code.
- Check-in is one conditional `UPDATE` in Postgres (`check_in_ticket`): a code admits once,
  even if two phones scan it at the same moment. Every scan attempt is logged in `scans`.
- Tier, price and guest count come from Stripe Price metadata, not from the checkout URL.
- A full refund in Stripe cancels the order's unused tickets automatically.
- All tables have RLS on with no policies; the browser never reads the database directly.

### Setting it up

1. **Supabase**: create a new project, then:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase functions deploy stripe-webhook ticket-view door
   ```
   Put the project URL and publishable key in `src/data/backend.ts`.
   In Authentication → Users, add the door user (`backend.doorEmail`, auto-confirm, strong password),
   and turn off public sign-ups.
2. **Resend**: verify `theonemorecompany.com` (DNS records in Hostinger) and create an API key.
3. **Stripe**: create the links and webhook:
   ```powershell
   $env:STRIPE_SECRET_KEY="sk_test_..."; $env:SITE_URL="https://theonemorecompany.com"
   $env:WEBHOOK_URL="https://<ref>.supabase.co/functions/v1/stripe-webhook"
   npm run stripe:setup
   ```
   Paste the printed links into `src/data/events.ts` and set the event `status: "on-sale"`.
4. **Secrets** for the functions:
   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
     RESEND_API_KEY=re_... TICKETS_FROM_EMAIL="One More <tickets@theonemorecompany.com>" \
     SITE_URL=https://theonemorecompany.com DOOR_EMAILS=door@theonemorecompany.com
   ```

Going live later = re-run step 3 with `sk_live_...`, set the live secrets, swap the links. Types for `Order`, `Ticket`, `TicketTier`, `CheckIn` and `ScanResult` are in
`src/types/ticketing.ts`.
