"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { brand } from "@/data/brand";
import { cn } from "@/lib/cn";
import { accessLabel, partnerBox, partnerLogoSrc, type VipPass } from "@/lib/vip";
import styles from "./vip.module.css";

const GOLD = "#C6A15B";

function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}

/**
 * The digital VIP credential. Black stock, one serif, one sans, a single ivory
 * card holding the code. `qrValue` is the opaque credential; it is rendered as
 * black modules on ivory with a four-module quiet zone and nothing inside it.
 */
export function VipCredential({ pass, qrValue, preview = false }: { pass: VipPass; qrValue: string; preview?: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const complete = pass.status === "complete";
  const event = pass.event;

  useEffect(() => {
    if (complete) return;
    let cancel = false;
    void QRCode.toString(qrValue, {
      type: "svg",
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#0F0F10", light: "#F6F1E8" },
    })
      .then((svg) => {
        if (!cancel) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [qrValue, complete]);

  return (
    <article className="relative mx-auto w-full max-w-[420px] text-[#F6F1E8]">
      <header className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.sealPath} alt={brand.logo.alt} width={38} height={38} className={cn("mx-auto size-[38px]", styles.fade)} />
        <p className={cn("mt-4 text-[0.6rem] font-semibold uppercase tracking-[0.42em] text-[#C6A15B]", styles.fade)} style={delay(120)}>
          The One More Company
        </p>
        <div aria-hidden className={cn("mx-auto mt-7 h-px w-10 bg-[#C6A15B]", styles.draw)} />
        <h1 className={cn("mt-8 font-event text-[2.65rem] font-medium leading-[1.02] tracking-[0.005em]", styles.rise)} style={delay(260)}>
          Private VIP Invitation
        </h1>
        {event && (
          <p className={cn("mt-4 text-[0.66rem] font-semibold uppercase tracking-[0.36em] text-[#E4D2AC]", styles.rise)} style={delay(340)}>
            {event.title}
          </p>
        )}
      </header>

      <section
        className={cn("relative mt-12 overflow-hidden rounded-[22px] border border-[#C6A15B]/22 px-6 pb-8 pt-8", styles.card, styles.rise)}
        style={delay(460)}
        aria-label="VIP credential"
      >
        <span aria-hidden className={cn("absolute inset-x-10 top-0 h-px", styles.sheen)} />
        <div className="text-center">
          <Label>VIP Table</Label>
          <p className="mt-2 font-event text-[2.15rem] font-medium leading-none">{pass.table}</p>
        </div>

        <dl className="mt-7 grid grid-cols-2 border-t border-[#F6F1E8]/[0.07] pt-5 text-center">
          <div className="border-r border-[#F6F1E8]/[0.07] px-2">
            <dt><Label>Host</Label></dt>
            <dd className="mt-1.5 truncate text-[0.95rem] font-medium tracking-[0.01em]">{pass.host}</dd>
          </div>
          <div className="px-2">
            <dt><Label>Access</Label></dt>
            <dd className="mt-1.5 text-[0.95rem] font-medium tracking-[0.01em]">{accessLabel(pass.capacity)}</dd>
          </div>
        </dl>

        <div className="mt-8 text-center">
          {complete ? (
            <div className={cn("mx-auto w-[232px] border border-[#C6A15B]/30 px-5 py-10", styles.reveal)} style={delay(700)}>
              <Label>VIP Access</Label>
              <p className="mt-4 font-event text-[1.75rem] font-medium leading-[1.05]">VIP Access Complete</p>
              <p className="mt-3 text-[0.68rem] leading-relaxed text-[#F6F1E8]/50">
                All {pass.capacity} {pass.capacity === 1 ? "admission has" : "admissions have"} been used.
              </p>
            </div>
          ) : (
            <>
              <Label>VIP Access</Label>
              <div className={cn("relative mx-auto mt-3.5 w-[232px] rounded-[10px] bg-[#F6F1E8] p-2", styles.reveal)} style={delay(700)}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`VIP access code ${pass.code}`} width={216} height={216} className="block size-[216px]" />
                ) : (
                  <div className="size-[216px]" aria-hidden />
                )}
                {preview && (
                  <span className="absolute inset-x-0 bottom-1 text-center text-[0.5rem] font-semibold uppercase tracking-[0.3em] text-[#0F0F10]/45">
                    Preview · not valid for entry
                  </span>
                )}
              </div>
              <p className="mt-5 text-[0.95rem] font-semibold tracking-[0.32em] tabular-nums">{pass.code}</p>
              <p className="mt-2 text-[0.55rem] font-semibold uppercase tracking-[0.38em] text-[#F6F1E8]/38">Private Table Credential</p>
              {pass.status === "partial" && (
                <p className="mt-5 text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-[#C6A15B]/85">
                  {pass.admitted} of {pass.capacity} arrived · {pass.remaining} remaining
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {event && (
        <section className={cn("mt-10 text-center", styles.rise)} style={delay(820)} aria-label="Event details">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em]">
            {event.shortDate}
            <span className="mx-2 text-[#C6A15B]">·</span>
            {event.time}
          </p>
          <p className="mt-4 text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[#F6F1E8]/85">{event.venue}</p>
          {event.city && <p className="mt-1.5 text-[0.62rem] uppercase tracking-[0.3em] text-[#F6F1E8]/45">{event.city}</p>}
          {event.minAge && <p className="mt-4 text-[0.6rem] font-semibold uppercase tracking-[0.34em] text-[#C6A15B]">{event.minAge}+ Only</p>}
          {event.mapUrl && !preview && (
            <a
              href={event.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block border-b border-[#F6F1E8]/15 pb-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.28em] text-[#F6F1E8]/55 transition-colors duration-500 hover:border-[#C6A15B]/60 hover:text-[#F6F1E8]"
            >
              Directions
            </a>
          )}
        </section>
      )}

      {pass.partners.length > 0 && (
        <section className={cn("mt-14", styles.fade)} style={delay(980)} aria-label="Official event partners">
          <div aria-hidden className="h-px bg-[#C6A15B]/20" />
          <p className="mt-6 text-center text-[0.55rem] font-semibold uppercase tracking-[0.4em] text-[#C6A15B]">Official Event Partners</p>
          <ul className={cn("mx-auto mt-5 grid gap-2.5", pass.partners.length === 1 ? "max-w-[9rem] grid-cols-1" : "grid-cols-2 min-[360px]:grid-cols-3")}>
            {pass.partners.map((partner) => {
              const box = partnerBox(partner.width, partner.height, { area: 2500, maxWidth: 88, maxHeight: 40 });
              return (
                <li key={partner.name} className={cn("flex h-[68px] items-center justify-center rounded-[8px] border border-[#F6F1E8]/10 bg-white px-2", styles.tile)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={partnerLogoSrc(partner.logo)} alt={partner.name} width={box.width} height={box.height} loading="lazy" style={{ width: box.width, height: box.height }} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className={cn("mx-auto mt-12 max-w-[30ch] text-center text-[0.68rem] leading-relaxed text-[#F6F1E8]/42", styles.fade)} style={delay(1080)}>
        Present this pass upon arrival. If your group arrives separately, the same pass remains valid until all allocated admissions have been used.
      </p>
    </article>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.4em]" style={{ color: GOLD }}>
      {children}
    </span>
  );
}
