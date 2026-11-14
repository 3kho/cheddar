"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addFunderAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";

export function FunderForm() {
  const router = useRouter();
  const [slackId, setSlackId] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const field = "h-9 rounded-md border border-line bg-surface-2 px-3 text-sm outline-none focus:border-primary";
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={slackId} onChange={(e) => setSlackId(e.target.value)} placeholder="Slack ID, e.g. U0123ABCD" className={`${field} sm:w-48`} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. HQ staff)" className={`${field} flex-1`} />
        <button
          disabled={!slackId.trim() || pending}
          onClick={() =>
            start(async () => {
              const r = await safely(addFunderAction(slackId, note));
              setResult(r);
              if (r.ok) {
                setSlackId("");
                setNote("");
                router.refresh();
              }
            })
          }
          className="rounded-[10px] bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          Add funder
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Works whether or not they use Cheddar: their Hackatime hours are pulled in by Slack ID and feed The Mouse right away. If they already have an account, their open orders are cancelled and their Latta Cheese and shares move to The Mouse.
      </p>
      {result && <Notice result={result} />}
    </div>
  );
}
