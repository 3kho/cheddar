/**
 * Geometry for the smooth charts: resampling step-function price history into evenly spaced
 * time-weighted averages, a monotone cubic spline through them (never overshoots, so a line
 * at 0% or 100% stays inside the chart), and "nice" axis ticks. Pure functions, no DOM.
 */

export interface TimePoint {
  t: number;
  v: number;
}
export interface Pt {
  x: number;
  y: number;
}

/** Last value at or before t (prices are a step function), or null before the first point. */
export function stepAt(points: TimePoint[], t: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) {
      found = points[mid]!.v;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Index of the first point strictly after t. */
function firstAfter(points: TimePoint[], t: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Time-weighted average of the step function over [a, b], ignoring time before the first point. */
function average(points: TimePoint[], a: number, b: number): number | null {
  let v = stepAt(points, a);
  let t = a;
  let area = 0;
  let covered = 0;
  for (let i = firstAfter(points, a); i < points.length && points[i]!.t < b; i++) {
    if (v != null) {
      area += v * (points[i]!.t - t);
      covered += points[i]!.t - t;
    }
    v = points[i]!.v;
    t = points[i]!.t;
  }
  if (v != null) {
    area += v * (b - t);
    covered += b - t;
  }
  return covered > 0 ? area / covered : null;
}

/**
 * Evenly spaced samples across [t0, t1] for drawing: the exact value at t0, one time-weighted
 * average per bucket, and the exact latest value at t1 (so the line ends on the real price).
 */
export function resample(points: TimePoint[], t0: number, t1: number, buckets: number): TimePoint[] {
  if (!points.length || t1 <= t0) return [];
  const out: TimePoint[] = [];
  const start = stepAt(points, t0);
  if (start != null) out.push({ t: t0, v: start });
  const w = (t1 - t0) / buckets;
  for (let i = 0; i < buckets; i++) {
    const a = t0 + i * w;
    const v = average(points, a, a + w);
    if (v != null) out.push({ t: a + w / 2, v });
  }
  const end = stepAt(points, t1);
  if (end != null) out.push({ t: t1, v: end });
  return out;
}

/** Fritsch–Carlson tangents for a monotone cubic through points sorted by x. */
export function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.x - pts[i]!.x;
    d.push(dx === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / dx);
  }
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i]!;
      m[i + 1] = k * b * d[i]!;
    }
  }
  return m;
}

const f = (n: number) => n.toFixed(2);

/** SVG path data for the spline. */
export function splinePath(pts: Pt[], m: number[]): string {
  if (!pts.length) return "";
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  if (pts.length === 1) return d + ` H${f(pts[0]!.x + 0.01)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const dx = (p1.x - p0.x) / 3;
    d += ` C${f(p0.x + dx)},${f(p0.y + m[i]! * dx)} ${f(p1.x - dx)},${f(p1.y - m[i + 1]! * dx)} ${f(p1.x)},${f(p1.y)}`;
  }
  return d;
}

/** The spline's y at x, or null outside the points' x range. */
export function splineAt(pts: Pt[], m: number[], x: number): number | null {
  const n = pts.length;
  if (!n || x < pts[0]!.x || x > pts[n - 1]!.x) return null;
  if (n === 1) return pts[0]!.y;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid]!.x <= x) lo = mid;
    else hi = mid - 1;
  }
  const p0 = pts[lo]!;
  const p1 = pts[lo + 1]!;
  const h = p1.x - p0.x;
  if (h === 0) return p0.y;
  const s = (x - p0.x) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0.y + (s3 - 2 * s2 + s) * h * m[lo]! + (-2 * s3 + 3 * s2) * p1.y + (s3 - s2) * h * m[lo + 1]!
  );
}

/** A tidy axis: about `count` ticks on round steps (1, 2, 2.5, 5 × 10ⁿ), and the domain they span. */
export function niceDomain(lo: number, hi: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: a, hi: b, ticks };
}
