/**
 * Display helpers shared by server and client. Money is always integer ticks (100 = 1 Latta Cheese).
 * The currency is Latta Cheese, written "Lc" after the amount: 12.50 Lc.
 */

export const CURRENCY = "Lc";
export const CURRENCY_NAME = "Latta Cheese";

export const TICKS_PER_LATTA = 100;

export function formatLatta(ticks: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const neg = ticks < 0;
  const abs = Math.abs(ticks);
  const whole = Math.floor(abs / TICKS_PER_LATTA);
  const cents = abs % TICKS_PER_LATTA;
  let body: string;
  if (opts.compact && whole >= 1_000_000) body = `${trim(whole / 1_000_000)}m`;
  else if (opts.compact && whole >= 10_000) body = `${trim(whole / 1_000)}k`;
  else if (opts.compact && cents === 0) body = whole.toLocaleString("en-US");
  else body = `${whole.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
  const prefix = neg ? "-" : opts.sign && ticks > 0 ? "+" : "";
  return `${prefix}${body} ${CURRENCY}`;
}

function trim(n: number): string {
  return (Math.floor(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

/** "12.5" -> 1250 ticks. Exact: never goes through floating point. Null if invalid. */
export function parseLatta(input: string): number | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(input.replace(/,/g, ""));
  if (!m) return null;
  return Number(m[1]) * TICKS_PER_LATTA + Number((m[2] ?? "").padEnd(2, "0"));
}

export function formatCents(price: number | null | undefined): string {
  return price == null ? "—" : `${price}¢`;
}

export function formatChance(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p < 1) return "<1%";
  if (p > 99) return ">99%";
  return `${p}%`;
}

export function formatShares(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeUntil(d: Date | string, now = Date.now()): string {
  const ms = new Date(d).getTime() - now;
  if (ms <= 0) return "Closed";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
  if (h < 48) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

/**
 * Displayed probability, Polymarket-style: the midpoint when the spread is tight,
 * otherwise the last traded price.
 */
export function chanceOf(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null && ask - bid <= 10) return Math.round((bid + ask) / 2);
  if (last != null) return last;
  if (bid != null && ask != null) return Math.round((bid + ask) / 2);
  return null;
}

export function timeAgo(d: Date | string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return formatDate(d);
}

/** Longest display name a user can pick on /profile. */
export const MAX_NAME_LENGTH = 32;
