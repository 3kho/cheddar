"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCategoryIconAction, type ActionResult } from "@/lib/actions";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";
import { IconPicker } from "./IconPicker";
import { WheelIcon } from "./Logo";

/** Per-category icon: opens a picker, saves on "Save icon". */
export function CategoryIconEditor({
  name,
  current,
  icons,
}: {
  name: string;
  current: string | null;
  icons: { value: string; label: string; src: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-primary hover:underline">
        {open ? "Close" : "Change icon"}
      </button>
      {open && (
        <div className="mt-2 w-full max-w-md rounded-lg bg-surface-2 p-3 text-left">
          <IconPicker
            value={value}
            onChange={setValue}
            icons={icons}
            defaultLabel="Category icon"
            defaultPreview={<WheelIcon icon={null} category={name} size={34} ignoreCategoryIcon />}
            uploaded={(url) => <WheelIcon icon={url} category={name} size={34} />}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={pending || value === (current ?? "")}
              onClick={() =>
                start(async () => {
                  const r = await safely(setCategoryIconAction(name, value));
                  setResult(r);
                  if (r.ok) router.refresh();
                })
              }
              className="rounded-[10px] bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              Save icon
            </button>
            {result && <Notice result={result} />}
          </div>
        </div>
      )}
    </div>
  );
}
