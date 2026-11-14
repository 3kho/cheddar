import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { eq, wheels } from "@cheddar/db";
import { getDb } from "@/lib/db";

export const alt = "A market on Cheddar";
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
 * A market's link card: the Cheddar frame with the cheese slice on the left, the market's own
 * picture sitting on top of the slice (just the slice when it has none), and its question on the right.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const [w] = await db.select({ title: wheels.title, icon: wheels.icon }).from(wheels).where(eq(wheels.slug, slug));
  const frame = await readFile(new URL("../../../assets/og-market-frame.png", import.meta.url));
  const bg = `data:image/png;base64,${frame.toString("base64")}`;
  const pic = await iconPng(w?.icon ?? null);
  const title = (w?.title ?? "Cheddar").slice(0, 140);
  const fontSize = title.length > 90 ? 38 : title.length > 55 ? 46 : 56;
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
            left: 580,
            top: 130,
            width: 560,
            height: 370,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ color: "#FFE08A", fontSize, lineHeight: 1.15, fontWeight: 700, letterSpacing: -1 }}>{title}</div>
          <div style={{ marginTop: 28, color: "#FDA444", fontSize: 30 }}>Trade it on Cheddar</div>
        </div>
      </div>
    ),
    size,
  );
}
