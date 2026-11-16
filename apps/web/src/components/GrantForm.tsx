"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { grantLattaAction, type ActionResult } from "@/lib/actions";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";

/** "Grant Lc" on a user row: an amount and a reason, then it's minted from the house straight to them. */
export function GrantForm({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const field = "h-8 rounded-md border border-line bg-surface-2 px-2 text-xs outline-none focus:border-primary";

  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">
          Grant Lc
        </button>
        {result?.ok && <Notice result={result} />}
      </span>
    );
  }
  const ready = amount.trim() && reason.trim() && !pending;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Lc"
        aria-label="Amount in Lc"
        className={`${field} w-20`}
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="Reason (logged)"
        aria-label="Reason"
        className={`${field} w-44`}
      />
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          if (!window.confirm(`Grant ${amount.trim()} Lc to ${name} from the house?`)) return;
          start(async () => {
            const r = await safely(grantLattaAction(userId, amount, reason));
            setResult(r);
            if (r.ok) {
              setOpen(false);
              setAmount("");
              setReason("");
              router.refresh();
            }
          });
        }}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
      >
        Grant
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-muted hover:text-ink">
        Cancel
      </button>
      {result && !result.ok && <Notice result={result} />}
    </span>
  );
}
