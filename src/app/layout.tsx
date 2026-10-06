import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { brand } from "@/data/brand";
import { isLogoAvailable } from "@/lib/brand-assets";
import { BrandAssetsProvider } from "@/components/ui/BrandAssetsProvider";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { INTRO_STORAGE_KEY } from "@/components/intro/intro-key";
import "./globals.css";

/*
 * Self-hosted, SIL Open Font License typefaces (latin subset).
 * Manrope — display, UI and body.
 * Instrument Serif — the occasional editorial accent.
 */
const manrope = localFont({
  variable: "--font-manrope",
  display: "swap",
  src: [{ path: "../fonts/Manrope-Variable.woff2", weight: "200 800", style: "normal" }],
});

const instrumentSerif = localFont({
  variable: "--font-instrument",
  display: "swap",
  src: [
    { path: "../fonts/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: brand.name,
    template: `%s — ${brand.name}`,
  },
  description: brand.description,
  openGraph: {
    title: brand.name,
    description: brand.description,
    type: "website",
    siteName: brand.name,
  },
  twitter: { card: "summary_large_image", title: brand.name, description: brand.description },
};

export const viewport: Viewport = {
  themeColor: brand.colors.richBlack,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const logoAvailable = isLogoAvailable();

  return (
    <html
      lang="en"
      className={`${manrope.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("${INTRO_STORAGE_KEY}"))document.documentElement.dataset.intro="seen"}catch(e){}`,
          }}
        />
        <noscript>
          <style>{`[data-intro-overlay]{display:none}`}</style>
        </noscript>
      </head>
      <body className="flex min-h-full flex-col bg-rich text-ivory">
        <BrandAssetsProvider value={{ logoAvailable }}>
          <MotionProvider>{children}</MotionProvider>
        </BrandAssetsProvider>
      </body>
    </html>
  );
}
