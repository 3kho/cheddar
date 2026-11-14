"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptFairPlayAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";

export function FairPlayForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await safely(acceptFairPlayAction());
          setResult(r);
          if (r.ok) router.push(returnTo);
        });
      }}
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2 p-3.5 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span>
          I&apos;ve read the rules above and I&apos;ll play fair. I understand that <strong>insider trading is strictly prohibited</strong> and
          that my account can be suspended or banned if I break these rules.
        </span>
      </label>
      <button
        disabled={!agreed || pending}
        className="mt-4 h-10 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
      {result && <Notice result={result} />}
    </form>
  );
}
