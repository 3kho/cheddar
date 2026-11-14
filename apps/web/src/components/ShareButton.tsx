"use client";

import { useState } from "react";

/** Shares a link with the phone's share sheet when there is one, otherwise copies it. */
export function ShareButton({
  url,
  title,
  text,
  label = "Share",
  className = "",
}: {
  url: string;
  title?: string;
  text?: string;
  label?: string;
  className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const done = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(null), 2500);
  };
  return (
    <button
      type="button"
      className={
        className ||
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-surface-2 px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-ink"
      }
      onClick={async () => {
        try {
          if (navigator.share) {
            await navigator.share({ url, title, text });
            return;
          }
        } catch (e) {
          if ((e as { name?: string })?.name === "AbortError") return; // they closed the sheet
        }
        try {
          await navigator.clipboard.writeText(url);
          done("Link copied");
        } catch {
          done("Copy the link from the address bar");
        }
      }}
    >
      {note ?? label}
    </button>
  );
}
