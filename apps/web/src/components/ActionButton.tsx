"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult, ReviewExtra } from "@/lib/actions";

/** A button that runs a (bound) server action and shows its result inline. */
export function ActionButton({
  action,
  children,
  className = "",
  confirm,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={`disabled:opacity-50 ${className}`}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await safely(action());
            setMsg(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? "…" : children}
      </button>
      {msg && <Notice result={msg} />}
    </span>
  );
}

export function Notice({ result }: { result: ActionResult }) {
  return (
    <span role="status" className={`text-xs ${result.ok ? "text-yes" : "text-no"}`}>
      {result.ok ? result.message : result.error}
    </span>
  );
}

/**
 * Approve / reject for Cheesemonger review queues, with an optional note and (for settlements)
 * the public proof that approving publishes. Both buttons are two-step: the first click only shows
 * exactly what will happen, so a stray click (or the wrong button) can't settle a wheel.
 */
export function ReviewButtons({
  action,
  approveConsequence,
  rejectConsequence,
  noteLabel = "Note (optional, shown to the author)",
  proof,
  liquidity,
}: {
  action: (approve: boolean, note: string, extra: ReviewExtra) => Promise<ActionResult>;
  /** What approving does, e.g. "Zach wins. Pays ʟ412.00 to 9 holders." */
  approveConsequence: string;
  rejectConsequence: string;
  noteLabel?: string;
  /** Ask for public proof, required to approve. */
  proof?: { label: string; placeholder: string; hint: string };
  /** Ask for The Mouse's liquidity on approval, starting at this value. */
  liquidity?: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [proofText, setProofText] = useState("");
  const [depth, setDepth] = useState(String(liquidity ?? 0));
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const needsProof = !!proof && !proofText.trim();
  const run = (approve: boolean) =>
    start(async () => {
      const r = await safely(action(approve, note, {
        proof: proof ? proofText : undefined,
        liquidity: liquidity != null ? Math.max(0, Math.trunc(Number(depth) || 0)) : undefined,
      }));
      setMsg(r);
      setConfirming(null);
      if (r.ok) router.refresh();
    });

  if (msg?.ok) return <div className="mt-3"><Notice result={msg} /></div>;

  const field = "w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-bg";
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {proof && (
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-sm font-semibold">
            {proof.label}
            <span className="text-xs font-normal text-muted">Public · needed to approve</span>
          </span>
          <textarea value={proofText} onChange={(e) => setProofText(e.target.value)} rows={3} placeholder={proof.placeholder} className={`${field} py-2`} />
          <span className="mt-1 block text-xs text-muted">{proof.hint}</span>
        </label>
      )}
      {liquidity != null && (
        <label className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <span>
            <span className="block text-sm font-semibold">Liquidity (The Mouse)</span>
            <span className="block text-xs text-muted">How deep The Mouse quotes. 0 turns it off; 300 is a good start.</span>
          </span>
          <input
            type="number"
            min={0}
            step={50}
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            className="h-9 w-28 rounded-lg border border-line bg-bg px-3 text-right text-sm font-semibold tabular outline-none focus:border-primary"
          />
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-muted">{noteLabel}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={`${field} h-9`} />
        </label>
        <div className="flex gap-2">
          <button
            disabled={pending}
            onClick={() => setConfirming("approve")}
            aria-pressed={confirming === "approve"}
            className="h-9 rounded-lg bg-yes-solid px-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Approve…
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirming("reject")}
            aria-pressed={confirming === "reject"}
            className="h-9 rounded-lg bg-no-solid px-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Reject…
          </button>
        </div>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={confirming === "approve" ? "Confirm approval" : "Confirm rejection"}
          className={`flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center ${
            confirming === "approve" ? "border-yes/50 bg-yes-soft" : "border-no/50 bg-no-soft"
          }`}
        >
          <p className="flex-1">
            <strong>{confirming === "approve" ? "Approve:" : "Reject:"}</strong>{" "}
            {confirming === "approve" ? approveConsequence : rejectConsequence}
            {confirming === "approve" && needsProof && (
              <span className="mt-1 block font-semibold text-no">Write the proof above first.</span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              disabled={pending || (confirming === "approve" && needsProof)}
              onClick={() => run(confirming === "approve")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
                confirming === "approve" ? "bg-yes-solid" : "bg-no-solid"
              }`}
            >
              {pending ? "…" : confirming === "approve" ? "Yes, approve" : "Yes, reject"}
            </button>
            <button disabled={pending} onClick={() => setConfirming(null)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:text-ink">
              Back
            </button>
          </div>
        </div>
      )}
      {msg && !msg.ok && <Notice result={msg} />}
    </div>
  );
}

/** Opens an inline "reason" box, then runs the action with it (suspend, pause, …). */
export function ReasonAction({
  action,
  label,
  placeholder,
  danger = false,
  optional = false,
}: {
  action: (reason: string) => Promise<ActionResult>;
  label: string;
  placeholder: string;
  danger?: boolean;
  optional?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const tone = danger ? "text-no" : "text-ink";
  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={() => setOpen(true)} className={`text-xs font-semibold hover:underline ${tone}`}>
          {label}
        </button>
        {msg && <Notice result={msg} />}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-56 rounded-md border border-line bg-surface-2 px-2 text-xs outline-none focus:border-primary"
      />
      <button
        type="button"
        disabled={pending || (!optional && !reason.trim())}
        onClick={() =>
          start(async () => {
            const r = await safely(action(reason));
            setMsg(r);
            if (r.ok) {
              setOpen(false);
              setReason("");
              router.refresh();
            }
          })
        }
        className={`rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-40 ${danger ? "bg-no-solid" : "bg-ink !text-bg"}`}
      >
        {pending ? "…" : label}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
        Cancel
      </button>
      {msg && !msg.ok && <Notice result={msg} />}
    </span>
  );
}
