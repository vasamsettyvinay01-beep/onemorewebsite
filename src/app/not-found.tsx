import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/data/brand";
import { Button } from "@/components/ui/Button";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { EmblemGhost } from "@/components/ui/EmblemGhost";
import { Grain } from "@/components/ui/Grain";

export const metadata: Metadata = {
  title: "Not here",
};

/** Even the wrong door should feel like the house. */
export default function NotFound() {
  return (
    <main className="relative flex min-h-[100svh] flex-1 flex-col overflow-hidden">
      <EmblemGhost className="right-[-35%] top-1/2 w-[130vw] max-w-[70rem] -translate-y-1/2 sm:right-[-12%] sm:w-[70vw]" opacity={0.07} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 50% at 20% 60%, rgba(187,155,99,0.08), transparent 70%)" }}
      />

      <div className="page-container relative z-10 flex flex-1 flex-col justify-between py-8 sm:py-12">
        <Link href="/" aria-label={`${brand.name} — home`} className="block w-12 sm:w-14">
          <BrandLogo size="sm" decorative />
        </Link>

        <div className="py-16">
          <p className="eyebrow text-gold">Error 404</p>
          <h1 className="font-headline mt-6 text-statement text-ivory">
            <span className="block">One step</span>
            <span className="block text-gold-soft">too far.</span>
          </h1>
          <p className="font-editorial mt-6 max-w-[28ch] text-[clamp(1.25rem,2.4vw,1.75rem)] text-ivory-muted">
            There&apos;s always one more — just not on this page.
          </p>
          <div className="mt-12">
            <Button href="/" variant="line" size="lg" arrow>
              Back to the house
            </Button>
          </div>
        </div>

        <p className="eyebrow text-[0.58rem] text-ivory/40">
          {brand.name} · Est. {brand.foundedYear}
        </p>
      </div>

      <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
        <Grain opacity={0.05} />
      </div>
    </main>
  );
}
