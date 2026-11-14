import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { eq, wheels } from "@cheddar/db";
import { getDb } from "@/lib/db";

export const alt = "A market on Cheddar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The uploaded icon as a PNG data URL (the renderer can't draw WebP), or null for built-in/none. */
async function iconPng(icon: string | null): Promise<string | null> {
  const m = icon?.match(/^data:image\/(?:png|jpeg|webp|gif);base64,(.+)$/);
  if (!m) return null;
  try {
    const png = await sharp(Buffer.from(m[1]!, "base64")).resize(360, 360, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const [w] = await db.select({ title: wheels.title, icon: wheels.icon }).from(wheels).where(eq(wheels.slug, slug));
  const coin = `data:image/svg+xml;base64,${(await readFile(new URL("../../icon.svg", import.meta.url))).toString("base64")}`;
  const pic = await iconPng(w?.icon ?? null);
  const title = w?.title ?? "Cheddar";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 80px",
          background: "linear-gradient(135deg, #fff8e6 0%, #ffe9b0 100%)",
          color: "#1d1d1f",
        }}
      >
        {/* eslint-disable @next/next/no-img-element */}
        {pic ? (
          <img src={pic} width={360} height={360} alt="" style={{ borderRadius: 48, flexShrink: 0 }} />
        ) : (
          <img src={coin} width={300} height={300} alt="" style={{ flexShrink: 0 }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: title.length > 70 ? 46 : 60, fontWeight: 700, lineHeight: 1.15, letterSpacing: -1 }}>{title.slice(0, 140)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 36, fontSize: 32, color: "#8a5a00" }}>
            <img src={coin} width={44} height={44} alt="" />
            Trade it on Cheddar
          </div>
        </div>
      </div>
    ),
    size,
  );
}
