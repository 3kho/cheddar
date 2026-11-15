"use client";

import { useRef, useState } from "react";
import { ImageIcon, UploadIcon } from "./Icons";

const ICON_PX = 128;
export const MAX_ICON_CHARS = 200_000;

/** Crop an image to a centred square and shrink it to ICON_PX, as WebP (PNG where WebP can't be encoded). */
async function imageToIcon(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, ICON_PX, ICON_PX);
  bmp.close();
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

function Choice({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`rounded-[10px] p-1 transition ${selected ? "bg-primary-soft ring-2 ring-primary" : "hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

/**
 * Icon choices, in this order: the default ("Category icon"), "Upload Icon", then the pictures from
 * public/market-icons. `value` is "" (default), "img:<file>" or a data: URL.
 */
export function IconPicker({
  value,
  onChange,
  icons,
  defaultPreview,
  defaultLabel = "Category icon",
  uploaded,
}: {
  value: string;
  onChange: (v: string) => void;
  icons: { value: string; label: string; src: string }[];
  /** What the default choice looks like. */
  defaultPreview: React.ReactNode;
  defaultLabel?: string;
  /** How an uploaded icon looks once chosen. */
  uploaded: (dataUrl: string) => React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setError("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > 8 * 1024 * 1024) return setError("That image is over 8 MB.");
    try {
      const url = await imageToIcon(file);
      if (url.length > MAX_ICON_CHARS) return setError("That image is still too big after shrinking. Try a simpler one.");
      onChange(url);
    } catch {
      setError("Couldn't read that image.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Choice selected={value === ""} onClick={() => onChange("")} label={defaultLabel}>
          {defaultPreview}
        </Choice>
        <Choice selected={value.startsWith("data:")} onClick={() => fileRef.current?.click()} label="Upload Icon">
          {value.startsWith("data:") ? (
            uploaded(value)
          ) : (
            <span className="grid h-[34px] w-[34px] place-items-center rounded-lg text-muted">
              <UploadIcon size={18} />
            </span>
          )}
        </Choice>
        {icons.map((i) => (
          <Choice key={i.value} selected={value === i.value} onClick={() => onChange(i.value)} label={i.label}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.src} alt="" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
          </Choice>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${error ? "text-no" : "text-muted"}`}>
        <ImageIcon size={13} />
        {error ?? "Pick an icon or upload a square-ish image. It's cropped and shrunk to 128px."}
      </p>
    </div>
  );
}
