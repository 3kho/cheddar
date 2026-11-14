"use client";

import { safely } from "@/lib/safely";

import { useState, useTransition } from "react";
import { reportAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";

/** "Report" link that opens a small box asking what's wrong. For a wheel or a person's name. */
export function ReportButton({ targetType, targetId, label = "Report" }: { targetType: "wheel" | "user"; targetId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <span className="text-xs text-muted">{result.message}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-muted hover:text-ink hover:underline">
        {label}
      </button>
    );
  }
  return (
    <form
      className="w-full max-w-sm rounded-xl border border-line bg-surface p-3 shadow-mid"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await safely(reportAction(targetType, targetId, reason))));
      }}
    >
      <label className="mb-1 block text-xs font-semibold" htmlFor={`report-${targetId}`}>
        What&apos;s wrong?
      </label>
      <textarea
        id={`report-${targetId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder={targetType === "wheel" ? "Unclear question, duplicate, rule-breaking, wrong result…" : "Offensive or misleading name…"}
        className="w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={reason.trim().length < 10 || pending}
          className="h-8 rounded-[10px] bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-muted hover:text-ink">
          Cancel
        </button>
      </div>
      {result && !result.ok && <Notice result={result} />}
    </form>
  );
}
