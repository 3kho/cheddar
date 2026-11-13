"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeSettlementAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";
import { ChevronDownIcon, MoldIcon } from "./Icons";

/**
 * Asking to close a wheel: the creator (or a Cheesemonger) says how it came out and why.
 * Trading pauses straight away; a Cheesemonger then settles it (with public proof) or reopens it.
 */
export function SettleForm({ wheelId, wedges, id }: { wheelId: string; wedges: { id: string; label: string }[]; id?: string }) {
  const router = useRouter();
  const binary = wedges.length === 1;
  const [choice, setChoice] = useState("");
  const [evidence, setEvidence] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const options = binary
    ? [
        { value: `wedge:${wedges[0]!.id}`, label: "Yes" },
        { value: "all_no", label: "No" },
      ]
    : wedges.map((w) => ({ value: `wedge:${w.id}`, label: `${w.label} wins` }));

  return (
    <details id={id} className="group/close scroll-mt-32 rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 hover:bg-hover [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-semibold">Request to close</span>
          <span className="block text-sm text-muted">Know the result? Ask the Cheesemongers to settle this wheel.</span>
        </span>
        <ChevronDownIcon size={16} className="shrink-0 text-muted transition-transform group-open/close:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">What happened?</legend>
          <div className="flex flex-wrap gap-2">
            {[...options, { value: "moldy", label: "Void it (Moldy, 50/50)" }].map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setChoice(o.value)}
                aria-pressed={choice === o.value}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  choice === o.value ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                }`}
              >
                {o.value === "moldy" && <MoldIcon size={14} />}
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-sm font-semibold">
            Why?
            <span className="text-xs font-normal text-muted">Only Cheesemongers see this</span>
          </span>
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={3}
            placeholder="Links, screenshots, a Slack message…"
            className="w-full rounded-lg border border-line bg-surface-2 p-3 text-sm outline-none transition focus:border-primary focus:bg-bg"
          />
        </label>
        <p className="text-xs text-muted">
          Trading pauses as soon as you send this. A Cheesemonger checks it: if they agree the wheel ripens and pays
          out, otherwise trading reopens.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!choice || !evidence.trim() || pending}
            onClick={() =>
              start(async () => {
                const r = await proposeSettlementAction({ wheelId, choice, evidence });
                setResult(r);
                if (r.ok) router.refresh();
              })
            }
            className="h-10 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {pending ? "Sending…" : "Send request"}
          </button>
          {result && <Notice result={result} />}
        </div>
      </div>
    </details>
  );
}
