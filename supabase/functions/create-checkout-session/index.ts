// Retired. The live checkout is `checkout` (PaymentIntents + Houston tax).
// This endpoint used to create a Checkout Session from the catalog price
// without that tax. It stays deployed so an old client cannot buy a pass
// for the untaxed amount.

import { corsHeaders, json } from "../_shared/http.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  return json(req, { error: "This checkout is closed. Book from the event page." }, 410);
});
