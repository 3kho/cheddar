"use client";

import { useMemo, useState } from "react";
import { stepAt } from "@/lib/chart";
import { formatLatta } from "@/lib/format";
import { SmoothChart, type HoverInfo } from "./SmoothChart";

const RANGES = [
  { key: "1D", ms: 86_400_000 },
  { key: "1W", ms: 7 * 86_400_000 },
  { key: "1M", ms: 30 * 86_400_000 },
  { key: "ALL", ms: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/** Smooth area chart of a balance over time, with a headline and its change over the chosen range. */
export function ValueChart({
  points,
  now,
  current,
  label,
}: {
  points: { t: number; v: number }[];
  now: number;
  /** Value shown when not hovering (e.g. live balance). */
  current: number;
  label: string;
}) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const all = useMemo(() => [...points, { t: now, v: current }], [points, now, current]);
  const span = RANGES.find((r) => r.key === range)!.ms;
  const first = all[0]?.t ?? now;
  const t0 = Number.isFinite(span) ? Math.max(first, now - span) : first;
  const t1 = Math.max(now, t0 + 60_000);

  const startV = stepAt(all, t0) ?? all[0]?.v ?? 0;
  const shown = hover?.values[0] != null ? Math.round(hover.values[0]) : current;
  const delta = shown - startV;
  const up = delta >= 0;
  // The line keeps the colour of the whole range's result, so it doesn't flicker while scrubbing.
  const rangeUp = current - startV >= 0;
  const color = rangeUp ? "var(--yes)" : "var(--no)";
  const series = useMemo(() => [{ label, color, points: all }], [label, color, all]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {label}
          </div>
          <div className="tabular mt-1 text-[30px] font-semibold leading-none tracking-tight">{formatLatta(shown)}</div>
          <div className={`tabular mt-1.5 text-sm font-semibold ${up ? "text-yes" : "text-no"}`}>
            {formatLatta(delta, { sign: true })}{" "}
            <span className="font-normal text-muted">
              {hover
                ? new Date(hover.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : range === "ALL"
                  ? "All time"
                  : `Past ${range === "1D" ? "day" : range === "1W" ? "week" : "month"}`}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={`h-7 rounded-md px-2 text-xs font-semibold uppercase transition-colors ${
                range === r.key ? "bg-primary-soft text-primary" : "text-muted hover:text-primary"
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <SmoothChart
          series={series}
          t0={t0}
          t1={t1}
          height={110}
          area
          minSpan={Math.max(100, Math.abs(current) * 0.02)}
          buckets={60}
          showYAxis={false}
          showXAxis={false}
          formatAxis={(v) => formatLatta(Math.round(v), { compact: true })}
          formatValue={(v) => formatLatta(Math.round(v))}
          onHover={setHover}
          animateKey={range}
        />
      </div>
    </div>
  );
}
