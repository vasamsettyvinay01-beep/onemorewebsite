import { ImageResponse } from "next/og";
import { brand } from "@/data/brand";
import { loadSealDataUri } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the official seal on rich black, with breathing room for iOS rounding. */
export default async function AppleIcon() {
  const seal = await loadSealDataUri();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brand.colors.richBlack,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={seal} width={148} height={148} alt="" />
      </div>
    ),
    size,
  );
}
