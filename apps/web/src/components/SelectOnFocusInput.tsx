"use client";

/** A read-only text box that selects everything when clicked, so a link is easy to copy. */
export function SelectOnFocusInput({ value, label }: { value: string; label: string }) {
  return (
    <input
      readOnly
      value={value}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none"
    />
  );
}
