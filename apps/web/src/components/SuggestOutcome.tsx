"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestOutcomeAction, type ActionResult } from "@/lib/actions";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";
import { ListPlusIcon, PlusIcon } from "./Icons";

/**
 * On wheels that are open to new outcomes: what's already been suggested, and a small form to
 * suggest another. A Cheesemonger approves each one before it becomes a tradable outcome.
 */
export function SuggestOutcome({
  wheelId,
  pending,
  canSuggest,
  loginHref,
  isCheesemonger,
}: {
  wheelId: string;
  pending: { id: string; label: string }[];
  canSuggest: boolean;
  /** Shown instead of the form for visitors who aren't logged in. */
  loginHref?: string;
  isCheesemonger: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none transition placeholder:text-faint focus:border-primary focus:bg-bg";

  return (
    <section className="rounded-xl border border-dashed border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ListPlusIcon size={18} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Missing an outcome?</h2>
            <p className="text-xs text-muted">
              This wheel takes suggestions. A Cheesemonger checks each one before it&apos;s added and tradable.
            </p>
          </div>
        </div>
        {!open &&
          (canSuggest ? (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setMsg(null);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-surface-2 px-3 text-sm font-semibold hover:bg-hover"
            >
              <PlusIcon size={15} /> Suggest one
            </button>
          ) : loginHref ? (
            <Link href={loginHref} className="inline-flex h-9 items-center rounded-[10px] bg-surface-2 px-3 text-sm font-semibold hover:bg-hover">
              Log in to suggest
            </Link>
          ) : null)}
      </div>

      {pending.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Waiting for review:</span>
          {pending.map((p) => (
            <span key={p.id} className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">
              {p.label}
            </span>
          ))}
          {isCheesemonger && (
            <Link href="/cheesemongers?tab=outcomes" className="font-semibold text-primary hover:underline">
              Review
            </Link>
          )}
        </div>
      )}

      {open && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            start(async () => {
              const r = await safely(requestOutcomeAction(wheelId, label, note));
              setMsg(r);
              if (r.ok) {
                setLabel("");
                setNote("");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="The outcome, e.g. “Zig”"
            className={`${field} h-10`}
            autoFocus
            aria-label="Outcome"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Why it could win (optional, for the Cheesemongers)"
            className={`${field} h-10`}
            aria-label="Why"
          />
          <div className="flex items-center gap-2">
            <button
              disabled={busy || !label.trim()}
              className="h-9 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "Sending…" : "Suggest"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-sm font-semibold text-muted hover:text-ink">
              Cancel
            </button>
            {msg && !msg.ok && <Notice result={msg} />}
          </div>
        </form>
      )}
      {msg?.ok && (
        <div className="mt-2">
          <Notice result={msg} />
        </div>
      )}
    </section>
  );
}
