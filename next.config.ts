import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static HTML export to /out — served as plain files on Hostinger (no Node server needed).
  output: "export",
  images: {
    // The default optimiser needs a server; artwork is already shipped as sized webp.
    unoptimized: true,
  },
};

export default nextConfig;
