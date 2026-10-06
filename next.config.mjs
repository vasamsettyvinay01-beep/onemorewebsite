// Plain ESM (not .ts): Hostinger's build servers lack the glibc for native SWC,
// and the WASM fallback cannot compile a TypeScript config.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static HTML export to /out — served as plain files on Hostinger (no Node server needed).
  output: "export",
  images: {
    // The default optimiser needs a server; artwork is already shipped as sized webp.
    unoptimized: true,
  },
};

export default nextConfig;
