"use client";

import { useId, useMemo, useState } from "react";
import { niceDomain, resample, splineAt, splinePath, tangents, type TimePoint } from "@/lib/chart";

export interface LineSeries {
  label: string;
  color: string;
  /** Ascending by time. Treated as a step function (a trade price holds until the next trade). */
  points: TimePoint[];
}

export interface HoverInfo {
  t: number;
  /** Each series' value under the cursor (null where it has no data yet). */
  values: (number | null)[];
}

const INSET = { top: 10, right: 44, bottom: 26 };

/**
 * Smooth line chart: time-weighted samples joined by a monotone spline, an auto-zoomed y axis,
 * a soft gradient under the first line, a draw-in animation, and a hover crosshair that puts a dot
 * on every line, dims what's to the right, and shows a tooltip.
 *
 * Only the lines are SVG (stretched to fit with non-scaling strokes); labels, dots and the tooltip
 * are HTML positioned by percentage, so nothing ever needs measuring and text never distorts.
 */
export function SmoothChart({
  series,
  t0,
  t1,
  height,
  area = false,
  clampLo,
  clampHi,
  minSpan = 0,
  formatAxis,
  formatValue,
  showYAxis = true,
  showXAxis = true,
  buckets = 80,
  onHover,
  animateKey,
}: {
  series: LineSeries[];
  t0: number;
  t1: number;
  height: number;
  /** Gradient fill under the first series. */
  area?: boolean;
  /** Keep the y axis inside these bounds (e.g. 0 and 100 for chances). */
  clampLo?: number;
  clampHi?: number;
  /** Smallest y span to show, so a flat line doesn't fill the chart with noise. */
  minSpan?: number;
  formatAxis: (v: number) => string;
  formatValue: (v: number) => string;
  showYAxis?: boolean;
  showXAxis?: boolean;
  buckets?: number;
  onHover?: (info: HoverInfo | null) => void;
  /** Change this to replay the draw-in animation (e.g. when the time range changes). */
  animateKey?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null); // 0..1 across the plot

  const geo = useMemo(() => {
    const sampled = series.map((s) => resample(s.points, t0, t1, buckets));
    const all = sampled.flat().map((p) => p.v);
    let lo = all.length ? Math.min(...all) : (clampLo ?? 0);
    let hi = all.length ? Math.max(...all) : (clampHi ?? 100);
    const span = Math.max(hi - lo, minSpan);
    const mid = (hi + lo) / 2;
    lo = mid - span / 2 - span * 0.12;
    hi = mid + span / 2 + span * 0.12;
    if (clampLo != null) lo = Math.max(clampLo, lo);
    if (clampHi != null) hi = Math.min(clampHi, hi);
    const dom = niceDomain(lo, hi, 4);
    if (clampLo != null) dom.lo = Math.max(clampLo, dom.lo);
    if (clampHi != null) dom.hi = Math.min(clampHi, dom.hi);
    const ticks = dom.ticks.filter((v) => v >= dom.lo && v <= dom.hi);
    const X = (t: number) => ((t - t0) / (t1 - t0)) * 1000;
    const Y = (v: number) => (1 - (v - dom.lo) / (dom.hi - dom.lo)) * 100;
    const lines = sampled.map((ps) => {
      const pts = ps.map((p) => ({ x: X(p.t), y: Y(p.v) }));
      const m = tangents(pts);
      const d = splinePath(pts, m);
      const fill = pts.length ? `${d} L${pts.at(-1)!.x.toFixed(2)},100 L${pts[0]!.x.toFixed(2)},100 Z` : "";
      return { pts, m, d, fill };
    });
    const fromY = (y: number) => dom.lo + (1 - y / 100) * (dom.hi - dom.lo);
    return { lines, ticks, Y, fromY };
  }, [series, t0, t1, buckets, clampLo, clampHi, minSpan]);

  const hx = hover == null ? null : hover * 1000;
  const hoverYs = hx == null ? [] : geo.lines.map((l) => splineAt(l.pts, l.m, hx));
  const hoverT = hover == null ? null : t0 + hover * (t1 - t0);

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const h = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(h);
    if (onHover) {
      const ys = geo.lines.map((l) => splineAt(l.pts, l.m, h * 1000));
      onHover({ t: t0 + h * (t1 - t0), values: ys.map((y) => (y == null ? null : geo.fromY(y))) });
    }
  };
  const leave = () => {
    setHover(null);
    onHover?.(null);
  };

  const short = t1 - t0 <= 2 * 86_400_000;
  const fmtTick = (t: number) =>
    new Date(t).toLocaleString("en-US", short ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
  const inset = { top: INSET.top, right: showYAxis ? INSET.right : 0, bottom: showXAxis ? INSET.bottom : 0 };
  const tipRows = series
    .map((s, i) => ({ s, y: hoverYs[i] }))
    .filter((r): r is { s: LineSeries; y: number } => r.y != null)
    .sort((a, b) => a.y - b.y);

  return (
    <div className="relative w-full select-none text-[11px] text-muted" style={{ height }}>
      {showYAxis &&
        geo.ticks.map((v) => (
          <span
            key={v}
            className="tabular absolute right-0 w-10 -translate-y-1/2 pl-2 font-medium"
            style={{ top: `calc(${inset.top}px + ${(geo.Y(v) / 100).toFixed(4)} * (100% - ${inset.top + inset.bottom}px))` }}
          >
            {formatAxis(v)}
          </span>
        ))}

      <div
        className="absolute left-0 touch-pan-y"
        style={{ top: inset.top, right: inset.right, bottom: inset.bottom }}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={leave}
        onPointerCancel={leave}
        role="img"
        aria-label={`Chart of ${series.map((s) => s.label).join(", ")}`}
      >
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`${id}g${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.26" />
                <stop offset="70%" stopColor={s.color} stopOpacity="0.05" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
            <clipPath id={`${id}reveal`}>
              <rect key={animateKey} className="chart-reveal" x="-5" y="-20" width="1010" height="140" />
            </clipPath>
            {hx != null && (
              <>
                <clipPath id={`${id}left`}>
                  <rect x="-5" y="-20" width={hx + 5} height="140" />
                </clipPath>
                <clipPath id={`${id}right`}>
                  <rect x={hx} y="-20" width={1005 - hx} height="140" />
                </clipPath>
              </>
            )}
          </defs>

          {showYAxis &&
            geo.ticks.map((v) => (
              <line
                key={v}
                x1={0}
                x2={1000}
                y1={geo.Y(v)}
                y2={geo.Y(v)}
                stroke="var(--border)"
                strokeDasharray="2 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          <g clipPath={`url(#${id}reveal)`}>
            {area && geo.lines[0]?.fill && (
              <path d={geo.lines[0].fill} fill={`url(#${id}g0)`} clipPath={hx != null ? `url(#${id}left)` : undefined} />
            )}
            {geo.lines.map((l, i) =>
              !l.d ? null : hx == null ? (
                <path
                  key={i}
                  d={l.d}
                  fill="none"
                  stroke={series[i]!.color}
                  strokeWidth={series.length === 1 ? 2.5 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <g key={i} stroke={series[i]!.color} fill="none" strokeWidth={series.length === 1 ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={l.d} clipPath={`url(#${id}left)`} vectorEffect="non-scaling-stroke" />
                  <path d={l.d} clipPath={`url(#${id}right)`} opacity="0.25" vectorEffect="non-scaling-stroke" />
                </g>
              ),
            )}
          </g>
        </svg>

        {/* Live end-of-line dots */}
        {hover == null &&
          geo.lines.map((l, i) => {
            const p = l.pts.at(-1);
            if (!p) return null;
            return (
              <span
                key={i}
                className="chart-dot pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x / 10}%`, top: `${p.y}%` }}
                aria-hidden="true"
              >
                <span className="absolute inset-0 animate-ping rounded-full opacity-50" style={{ background: series[i]!.color }} />
                <span className="absolute inset-0 rounded-full ring-2 ring-bg" style={{ background: series[i]!.color }} />
              </span>
            );
          })}

        {hover != null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-muted/40" style={{ left: `${hover * 100}%` }} />
            {hoverYs.map((y, i) =>
              y == null ? null : (
                <span
                  key={i}
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-bg"
                  style={{ left: `${hover * 100}%`, top: `${y}%`, background: series[i]!.color }}
                />
              ),
            )}
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg bg-surface px-3 py-2 text-xs text-ink shadow-pop"
              style={{
                left: `${hover * 100}%`,
                transform: `translateX(${hover > 0.6 ? "calc(-100% - 14px)" : "14px"})`,
              }}
            >
              <div className="mb-1 font-medium text-muted">
                {new Date(hoverT!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
              {tipRows.length === 0 ? (
                <div className="text-muted">No data yet</div>
              ) : (
                tipRows.map(({ s, y }) => (
                  <div key={s.label} className="flex items-center gap-2 py-0.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    {series.length > 1 && <span className="max-w-32 flex-1 truncate">{s.label}</span>}
                    <span className="tabular ml-auto font-semibold">{formatValue(geo.fromY(y))}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {showXAxis && (
        <div className="absolute bottom-0 left-0 h-5" style={{ right: inset.right }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
            <span
              key={f}
              className={`absolute whitespace-nowrap font-medium ${i === 0 ? "" : i === 4 ? "-translate-x-full" : "-translate-x-1/2"} ${
                i === 1 || i === 3 ? "hidden sm:inline" : ""
              }`}
              style={{ left: `${f * 100}%` }}
            >
              {fmtTick(t0 + f * (t1 - t0))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
