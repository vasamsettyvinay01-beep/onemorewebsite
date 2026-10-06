import { ImageResponse } from "next/og";
import { brand } from "@/data/brand";
import { loadOgFonts, loadSealDataUri } from "@/lib/og";

export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const gold = brand.colors.warmGold;
const ivory = brand.colors.warmIvory;

/** The share card: a framed, collectible plate rather than a screenshot. */
export default async function OpengraphImage() {
  const [fonts, seal] = await Promise.all([loadOgFonts(), loadSealDataUri()]);
  const domain = new URL(brand.url).hostname;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: brand.colors.richBlack,
          backgroundImage:
            "radial-gradient(circle at 79% 50%, rgba(187,155,99,0.24) 0%, rgba(187,155,99,0.08) 28%, rgba(15,16,15,0) 52%)",
          fontFamily: "Manrope",
          color: ivory,
        }}
      >

        {/* hairline frame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            bottom: 28,
            left: 28,
            display: "flex",
            border: "1px solid rgba(187,155,99,0.32)",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "78px 0 72px 84px",
            width: 700,
          }}
        >
          <div style={{ display: "flex", fontSize: 17, fontWeight: 600, letterSpacing: "0.34em", color: gold }}>
            THE ONE MORE COMPANY
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 92,
                fontWeight: 600,
                letterSpacing: "-0.045em",
                lineHeight: 0.95,
              }}
            >
              <span>{brand.copy.hero[0]}</span>
              <span style={{ color: "#D8C196" }}>{brand.copy.hero[1]}</span>
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 30,
                fontFamily: "Instrument Serif",
                fontStyle: "italic",
                fontSize: 34,
                color: "rgba(236,234,228,0.72)",
              }}
            >
              Elevated cultural &amp; social experiences.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: "0.28em",
              color: "rgba(236,234,228,0.5)",
            }}
          >
            <span>EST. {brand.foundedYear}</span>
            <span style={{ width: 40, height: 1, background: "rgba(187,155,99,0.6)" }} />
            <span>{domain.toUpperCase()}</span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 40 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={seal} width={380} height={380} alt="" />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
