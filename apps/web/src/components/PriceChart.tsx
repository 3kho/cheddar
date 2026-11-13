"use client";

import { useMemo, useState } from "react";
import { stepAt } from "@/lib/chart";
import { formatChance } from "@/lib/format";
import { SmoothChart, type HoverInfo, type LineSeries } from "./SmoothChart";

export interface Series {
  label: string;
  /** Current displayed chance (what the page shows next to the outcome). */
  chance: number | null;
  /** Trades: epoch ms and YES price in ticks, ascending. */
  points: { t: number; p: number }[];
}

const MULTI = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const BINARY = ["var(--chart-binary)"];
const RANGES = [
  { key: "1H", ms: 3_600_000 },
  { key: "6H", ms: 6 * 3_600_000 },
  { key: "1D", ms: 86_400_000 },
  { key: "1W", ms: 7 * 86_400_000 },
  { key: "1M", ms: 30 * 86_400_000 },
  { key: "ALL", ms: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Price history: range tabs, smooth lines, a crosshair that scrubs every series, and either a
 * headline chance (binary wheels) or a legend whose numbers follow the cursor.
 */
export function PriceChart({
  series,
  now,
  headline = false,
  height = 272,
  compact = false,
  meta,
  colors,
}: {
  series: Series[];
  now: number;
  /** Binary wheels: a big "62% chance" over the chart instead of a legend. */
  headline?: boolean;
  height?: number;
  /** Fewer range buttons and a smaller legend (cards). */
  compact?: boolean;
  /** Shown left of the range buttons, e.g. volume and close date. */
  meta?: React.ReactNode;
  /** Override the line colours (e.g. two team colours). */
  colors?: string[];
}) {
  const COLORS = colors ?? (headline || series.length === 1 ? BINARY : MULTI);
  const ranges = compact ? RANGES.filter((r) => r.key !== "1H" && r.key !== "6H") : RANGES;
  const [range, setRange] = useState<RangeKey>("ALL");
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const first = Math.min(...series.flatMap((s) => (s.points[0] ? [s.points[0].t] : [])), now);
  const span = RANGES.find((r) => r.key === range)!.ms;
  const t0 = Number.isFinite(span) ? Math.max(first, now - span) : first;
  const t1 = Math.max(now, t0 + 60_000);

  const colorKey = COLORS.join();
  const lines: LineSeries[] = useMemo(
    () => series.map((s, i) => ({ label: s.label, color: COLORS[i % COLORS.length]!, points: s.points.map((p) => ({ t: p.t, v: p.p })) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, colorKey],
  );

  const hasData = series.some((s) => s.points.length);
  const values = series.map((s, i) => (hover ? (hover.values[i] == null ? null : Math.round(hover.values[i]!)) : s.chance));
  const startValues = lines.map((l) => stepAt(l.points, t0) ?? l.points.find((p) => p.t >= t0)?.v ?? null);
  const head = values[0] ?? null;
  const headDelta = head != null && startValues[0] != null ? head - startValues[0]! : null;
  const hoverLabel = hover
    ? new Date(hover.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <figure>
      {headline ? (
        <div className="mb-2 flex min-h-8 items-baseline gap-2">
          <span className="tabular text-xl font-semibold sm:text-2xl" style={{ color: COLORS[0] }}>
            {formatChance(head)} chance
          </span>
          {headDelta != null && headDelta !== 0 && (
            <span className={`tabular inline-flex items-center gap-0.5 text-xs font-semibold ${headDelta > 0 ? "text-yes" : "text-no"}`}>
              <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
                <path d={headDelta > 0 ? "M5 1 9 8H1Z" : "M5 9 1 2h8Z"} fill="currentColor" />
              </svg>
              {Math.abs(headDelta)}%
            </span>
          )}
          {hoverLabel && <span className="text-xs text-muted">{hoverLabel}</span>}
        </div>
      ) : (
        <figcaption className={`mb-3 flex min-h-5 flex-wrap gap-x-4 gap-y-1 ${compact ? "text-xs" : "text-[13px]"}`}>
          {series.map((s, i) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="max-w-40 truncate text-muted">{s.label}</span>
              <span className="tabular font-semibold">{formatChance(values[i])}</span>
            </span>
          ))}
        </figcaption>
      )}

      {!hasData ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted" style={{ height }}>
          No trades yet. Be the first to set the price.
        </div>
      ) : (
        <SmoothChart
          series={lines}
          t0={t0}
          t1={t1}
          height={height}
          area={lines.length === 1}
          clampLo={0}
          clampHi={100}
          minSpan={10}
          buckets={compact ? 56 : 90}
          formatAxis={(v) => `${Math.round(v)}%`}
          formatValue={(v) => formatChance(Math.round(v))}
          onHover={setHover}
          animateKey={range}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5 text-[13px] text-muted">{meta}</div>
        <div className="ml-auto flex h-9 items-center gap-0.5" role="tablist" aria-label="Time range">
          {ranges.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={`h-7 rounded-md px-2 text-[13px] font-semibold uppercase transition-colors ${
                range === r.key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
    </figure>
  );
}
