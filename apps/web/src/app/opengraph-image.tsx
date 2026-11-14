import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

export const alt = "Cheddar: Hack Club's play-money prediction market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const coin = await readFile(new URL("./icon.svg", import.meta.url));
  const src = `data:image/svg+xml;base64,${coin.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 90px",
          background: "linear-gradient(135deg, #fff8e6 0%, #ffe9b0 100%)",
          color: "#1d1d1f",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={300} height={300} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: -3 }}>Cheddar</div>
          <div style={{ fontSize: 38, marginTop: 12, lineHeight: 1.25, maxWidth: 640 }}>
            Hack Club&apos;s play-money prediction market. Trade on what happens next.
          </div>
          <div style={{ fontSize: 26, marginTop: 24, color: "#8a5a00" }}>Earn Latta Cheese by coding</div>
        </div>
      </div>
    ),
    size,
  );
}
