"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeSettlementAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";
import { ChevronDownIcon, MoldIcon } from "./Icons";
import { formatDateEst } from "@/lib/format";

/**
 * Asking to close a wheel: the creator (or a Cheesemonger) says how it came out and why.
 * Trading pauses straight away; a Cheesemonger then settles it (with public proof) or reopens it.
 */
export function SettleForm({
  wheelId,
  wedges,
  id,
  marketType,
}: {
  wheelId: string;
  wedges: { id: string; label: string; dateValue: string | null }[];
  id?: string;
  marketType?: string | null;
}) {
  const router = useRouter();
  const binary = wedges.length === 1;
  const isDateMarket = marketType === "date";
  const [choice, setChoice] = useState("");
  /** For date markets: the ISO date/time string of the event. */
  const [eventDate, setEventDate] = useState("");
  /** For multi-winner markets: selected winning wedge ids. */
  const [winningWedgeIds, setWinningWedgeIds] = useState<string[]>([]);
  const [evidence, setEvidence] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const options = binary
    ? [
        { value: `wedge:${wedges[0]!.id}`, label: "Yes" },
        { value: "all_no", label: "No" },
      ]
    : wedges.map((w) => ({ value: `wedge:${w.id}`, label: `${w.label} wins` }));

  const toggleWedge = (wedgeId: string) => {
    setWinningWedgeIds((prev) =>
      prev.includes(wedgeId) ? prev.filter((id) => id !== wedgeId) : [...prev, wedgeId],
    );
  };

  const isSelected = (wedgeId: string) => winningWedgeIds.includes(wedgeId);

  /** Select a settlement outcome. For non-date, non-binary wedges this toggles
   *  the wedge into/out of the multi_yes winning set. */
  const handleOutcomeSelect = (o: { value: string; label: string }) => {
    if (!binary && !isDateMarket && o.value.startsWith("wedge:")) {
      const wedgeId = o.value.slice("wedge:".length);
      const isCurrentlySelected = winningWedgeIds.includes(wedgeId);
      const nextIds = isCurrentlySelected
        ? winningWedgeIds.filter((id) => id !== wedgeId)
        : [...winningWedgeIds, wedgeId];
      setWinningWedgeIds(nextIds);
      setChoice(nextIds.length > 0 ? "multi_yes" : "");
    } else {
      setChoice(o.value);
      if (o.value !== "all_yes") setWinningWedgeIds([]);
    }
  };

  const wedgeLabelWithDate = (w: { id: string; label: string; dateValue: string | null }) => {
    const label = w.label;
    const datePart = w.dateValue ? ` · ${formatDateEst(w.dateValue)}` : "";
    return `${label}${datePart}`;
  };

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
            {/* Standard outcome options */}
            {[...options, { value: "moldy", label: "Void it (Moldy, 50/50)" }].map((o) => {
              const isWedgeToggle = !binary && !isDateMarket && o.value.startsWith("wedge:");
              const wedgeId = isWedgeToggle ? o.value.slice("wedge:".length) : null;
              const isPressed = isWedgeToggle ? isSelected(wedgeId!) : choice === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleOutcomeSelect(o)}
                  aria-pressed={isPressed}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    isPressed ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                  }`}
                >
                  {o.value === "moldy" && <MoldIcon size={14} />}
                  {o.label}
                </button>
              );
            })}
            {isDateMarket && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setChoice("all_yes");
                    setWinningWedgeIds([]);
                  }}
                  aria-pressed={choice === "all_yes"}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    choice === "all_yes" ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                  }`}
                >
                  All dates: event didn't happen (all NO)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChoice("all_yes");
                    setWinningWedgeIds(wedges.map((w) => w.id));
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    choice === "all_yes_dates" ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                  }`}
                >
                  All dates: event happened by each date (all YES)
                </button>
              </>
            )}
            {!isDateMarket && !binary && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setChoice("all_yes");
                    setWinningWedgeIds([]);
                  }}
                  aria-pressed={choice === "all_yes"}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    choice === "all_yes" ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                  }`}
                >
                  All outcomes: every date Yes (all YES)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChoice("all_no");
                    setWinningWedgeIds([]);
                  }}
                  aria-pressed={choice === "all_no"}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    choice === "all_no" ? "border-primary bg-primary-soft text-ink" : "border-line hover:bg-hover"
                  }`}
                >
                  All outcomes: none happened (all NO)
                </button>
              </>
            )}
          </div>
        </fieldset>

        {/* Date market: event date picker */}
        {isDateMarket && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Event date & time</legend>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  placeholder="Pick when the event happened"
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-primary focus:bg-bg"
                />
                <span className="text-xs text-muted">ET</span>
              </label>
              <p className="text-xs text-muted">
                Wedges with dates on/after this become Yes; earlier dates become No.
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-4 mt-2 text-sm">
              {wedges.map((w) => {
                const date = w.dateValue ? new Date(w.dateValue) : null;
                const willBeYes = eventDate && date ? date >= new Date(eventDate) : false;
                return (
                  <div key={w.id} className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${willBeYes ? "text-yes" : "text-no"}`}>
                      {willBeYes ? "Yes" : "No"}
                    </span>
                    <span className="text-xs text-truncate max-w-[200px]">{w.label}</span>
                    {w.dateValue && <span className="text-xs text-muted">· {formatDateEst(w.dateValue)}</span>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Multi-winner: selected wedges */}
        {!isDateMarket && !binary && winningWedgeIds.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Winning outcomes</legend>
            <div className="flex flex-wrap gap-2">
              {wedges
                .filter((w) => winningWedgeIds.includes(w.id))
                .map((w) => (
                  <div key={w.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1">
                    <span className="text-xs font-semibold text-yes">{w.label}</span>
                    <button
                      type="button"
                      onClick={() => toggleWedge(w.id)}
                      className="text-xs text-muted hover:text-ink"
                    >
                      ✕
                    </button>
                  </div>
                ))}
            </div>
          </fieldset>
        )}

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
            disabled={
              !choice ||
              !evidence.trim() ||
              pending ||
              (isDateMarket && !eventDate) ||
              (choice === "multi_yes" && !isDateMarket && winningWedgeIds.length === 0)
            }
            onClick={() =>
              start(async () => {
                const r = await safely(
                  proposeSettlementAction({
                    wheelId,
                    choice,
                    winningWedgeIds:
                      choice === "multi_yes" && !isDateMarket
                        ? winningWedgeIds.map((id) => `wedge:${id}`).join(",")
                        : undefined,
                    eventDate: isDateMarket ? eventDate : undefined,
                    evidence,
                  }),
                );
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
