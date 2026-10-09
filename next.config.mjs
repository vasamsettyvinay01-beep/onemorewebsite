// Plain ESM (not .ts): Hostinger's build servers lack the glibc for native SWC,
// and the WASM fallback cannot compile a TypeScript config.
//
// Production is the Hostinger Next.js server. Hostinger imports this object and
// replaces `output` with `standalone`. `output: "export"` remains so the GitHub
// static publish still writes /out. Security headers below travel with the
// config object and are applied by the Node server, not by public/.htaccess.

const supabase = "https://curprrfrkefegefqiign.supabase.co";

// Stripe.js + Payment Element + Express Checkout (Apple Pay / Google Pay).
// Link, PayPal, Amazon Pay, and Klarna are disabled in CheckoutView.
// No Address Element, so Google Maps is not allowed.
// fonts.googleapis.com is the Elements cssSrc; Stripe requires it on connect-src.
// 'unsafe-inline' scripts: Next.js bootstrap plus the intro sessionStorage
// script. A nonce would not survive Hostinger's prerender cache. No unsafe-eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  `connect-src 'self' https://api.stripe.com https://fonts.googleapis.com ${supabase} wss://curprrfrkefegefqiign.supabase.co`,
  "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // payment=* because Apple Pay and Google Pay run inside Stripe frames on
  // js.stripe.com subdomains. Permissions-Policy cannot express that wildcard.
  // camera stays on this origin for the door QR scanner.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=*" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    // The default optimiser needs a server; artwork is already shipped as sized webp.
    unoptimized: true,
    qualities: [75, 90],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
