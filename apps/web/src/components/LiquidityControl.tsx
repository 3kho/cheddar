"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLiquidityAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";
import { MouseIcon } from "./Icons";

const PRESETS = [0, 100, 300, 1000, 3000];

/** A Cheesemonger's dial for how deep The Mouse quotes on one wheel. */
export function LiquidityControl({ wheelId, liquidity, outcomes }: { wheelId: string; liquidity: number; outcomes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(liquidity));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  const maxLoss = Math.round(n * Math.log(Math.max(2, outcomes === 1 ? 2 : outcomes)));

  if (!open) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-hover ${liquidity ? "text-ink" : "text-muted"}`}
        >
          <MouseIcon size={14} />
          {liquidity ? `Depth ${liquidity.toLocaleString("en-US")}` : "No market maker"}
        </button>
        {msg && <Notice result={msg} />}
      </span>
    );
  }
  return (
    <div className="w-full rounded-lg bg-surface-2 p-3 sm:w-auto">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setValue(String(p))}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${n === p ? "bg-ink text-bg" : "bg-surface text-muted hover:text-ink"}`}
          >
            {p === 0 ? "Off" : p.toLocaleString("en-US")}
          </button>
        ))}
        <input
          type="number"
          min={0}
          step={50}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-24 rounded-md border border-line bg-bg px-2 text-right text-xs font-semibold tabular outline-none focus:border-primary"
          aria-label="Liquidity"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await safely(setLiquidityAction(wheelId, n));
              setMsg(r);
              if (r.ok) {
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 px-1 text-xs text-muted hover:underline">
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        {n
          ? `About ${Math.max(1, Math.round(n / 25))} shares per cent near 50%. Worst case The Mouse loses ${maxLoss.toLocaleString("en-US")} Lc here.`
          : "The Mouse won't quote on this wheel."}
      </p>
      {msg && !msg.ok && <Notice result={msg} />}
    </div>
  );
}
