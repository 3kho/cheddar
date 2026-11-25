"use client";

import {
  applyDateText,
  blankDateDraft,
  draftsFromLadder,
  resolveDateDraft,
  type DateDraft,
  type LadderPreset,
} from "@/lib/market-dates";
import { PlusIcon, XIcon } from "./Icons";

const MAX_OUTCOMES = 30;
const field =
  "w-full rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none transition placeholder:text-faint focus:border-primary focus:bg-bg";

const LADDERS: { id: LadderPreset; label: string }[] = [
  { id: "month", label: "End of this month" },
  { id: "months", label: "Next 4 months" },
  { id: "quarters", label: "Quarters" },
  { id: "year", label: "End of this year" },
];

/** Date outcomes: type "March 31" or "end of June" and the match fills the label and the instant. */
export function DateOutcomes({
  rows,
  onChange,
  problem,
}: {
  rows: DateDraft[];
  onChange: (rows: DateDraft[]) => void;
  problem: string | null;
}) {
  const setRow = (id: string, next: DateDraft) => onChange(rows.map((r) => (r.id === id ? next : r)));

  return (
    <fieldset>
      <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-semibold">
        Dates
        <span className="text-xs font-normal text-muted">
          {rows.filter((r) => r.text.trim()).length}/{MAX_OUTCOMES}
        </span>
      </legend>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Date templates">
        {LADDERS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(draftsFromLadder(preset.id))}
            className="h-8 rounded-lg bg-surface-2 px-3 text-xs font-semibold text-muted hover:text-ink"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const matched = resolveDateDraft(row);
          const unmatched = row.text.trim().length > 0 && !matched;
          return (
            <li key={row.id} className="flex items-start gap-2">
              <span className="tabular mt-2.5 w-5 text-right text-xs font-semibold text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <input
                    value={row.text}
                    onChange={(e) => setRow(row.id, applyDateText(row, e.target.value))}
                    maxLength={80}
                    placeholder={i === 0 ? "March 31" : i === 1 ? "end of June" : "Q4 2027"}
                    aria-label={`Date ${i + 1}`}
                    data-date
                    className={`${field} h-10`}
                  />
                  {row.pinned ? (
                    <input
                      value={row.label}
                      onChange={(e) => setRow(row.id, { ...row, label: e.target.value })}
                      maxLength={80}
                      aria-label={`Name for date ${i + 1}`}
                      className={`${field} h-10 w-44 shrink-0`}
                    />
                  ) : (
                    <span className="hidden w-40 shrink-0 truncate text-sm font-medium sm:block">{matched?.label ?? ""}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                    disabled={rows.length <= 1}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                    aria-label={`Remove date ${i + 1}`}
                  >
                    <XIcon size={16} />
                  </button>
                </div>
                <div className={`mt-1 text-xs ${unmatched || matched?.past ? "text-no" : "text-muted"}`}>
                  {unmatched
                    ? "No date matched. Try “Mar 31”, “end of June”, or “Q2 2027”."
                    : matched
                      ? `Matches ${matched.when}${matched.past ? " · that date has passed" : ""}`
                      : "Type a date. It is read at 11:59 PM ET unless you add a time."}
                  {matched && !row.pinned && <span className="sm:hidden"> · {matched.label}</span>}
                  {matched && !row.pinned && (
                    <button
                      type="button"
                      onClick={() => setRow(row.id, { ...row, pinned: true, label: matched.label })}
                      className="ml-2 font-semibold text-primary hover:underline"
                    >
                      Rename
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
        <button
          type="button"
          onClick={() => onChange([...rows, blankDateDraft(`d-${Date.now()}`)])}
          disabled={rows.length >= MAX_OUTCOMES}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-line px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <PlusIcon size={15} /> Add a date
        </button>
        <span className={`text-xs ${problem && rows.some((r) => r.text.trim()) ? "text-no" : "text-muted"}`}>
          {problem && rows.some((r) => r.text.trim())
            ? problem
            : "Saved earliest first. Yes if the event has happened by that date, No if it has not."}
        </span>
      </div>
    </fieldset>
  );
}
