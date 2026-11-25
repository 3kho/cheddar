import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { marketEmbedState } from "@/lib/market-embed";
import { getWheel } from "@/lib/queries";

export const alt = "Current chance, volume, and status of a market on Cheddar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Where the cheese slice sits in the frame artwork (1200 x 630), so a market's picture can go on it.
const SLICE_CENTER = { x: 310, y: 316 };
const PIC = 230;

/** The uploaded icon as a PNG data URL (the renderer can't draw WebP), or null for built-in/none. */
async function iconPng(icon: string | null): Promise<string | null> {
  const m = icon?.match(/^data:image\/(?:png|jpeg|webp|gif);base64,(.+)$/);
  if (!m) return null;
  try {
    const png = await sharp(Buffer.from(m[1]!, "base64")).resize(PIC * 2, PIC * 2, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * A market's link card: the Cheddar frame, the market's picture on the cheese slice, and the
 * live state (chance, volume, status) on the right so an unfurl shows where the market is now.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getWheel(slug);
  const frame = await readFile(new URL("../../../assets/og-market-frame.png", import.meta.url));
  const bg = `data:image/png;base64,${frame.toString("base64")}`;
  const pic = await iconPng(data?.wheel.icon ?? null);
  const title = (data?.wheel.title ?? "Cheddar").slice(0, 140);
  const state = data ? marketEmbedState(data.wheel, data.settlement?.status === "pending") : null;
  const fontSize = title.length > 90 ? 32 : title.length > 55 ? 40 : 48;
  const proposed = state?.statusLabel === "Outcome proposed";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#000" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bg} width={1200} height={630} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
        {pic && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pic}
            width={PIC}
            height={PIC}
            alt=""
            style={{
              position: "absolute",
              left: SLICE_CENTER.x - PIC / 2,
              top: SLICE_CENTER.y - PIC / 2,
              borderRadius: 40,
              border: "6px solid #FFE08A",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 560,
            top: 78,
            width: 580,
            height: 474,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {state && (
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                marginBottom: 16,
                padding: "6px 14px",
                borderRadius: 999,
                background: proposed ? "#3A2E14" : "#1A1C22",
                color: proposed ? "#F5B83D" : "#C8CDD4",
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              {state.statusLabel}
            </div>
          )}
          <div style={{ color: "#FFE08A", fontSize, lineHeight: 1.12, fontWeight: 700, letterSpacing: -1 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 22, color: "#8EB4FF" }}>
            <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>{state?.chanceLabel ?? "—"}</div>
            {state?.chanceCaption ? (
              <div style={{ marginLeft: 14, marginBottom: 10, fontSize: 28, color: "#FDA444" }}>{state.chanceCaption}</div>
            ) : null}
          </div>
          <div style={{ marginTop: 14, color: "#E7E9EE", fontSize: 26 }}>{state?.volumeLabel ?? "Trade it on Cheddar"}</div>
          {state && state.outcomes.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 18, gap: 6 }}>
              {state.outcomes.map((o) => (
                <div key={o.label} style={{ display: "flex", justifyContent: "space-between", width: 460, color: "#F4F5F7", fontSize: 22 }}>
                  <div style={{ display: "flex" }}>{o.label.slice(0, 42)}</div>
                  <div style={{ display: "flex", color: "#8EB4FF", fontWeight: 700 }}>{o.chance}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
