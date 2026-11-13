/**
 * Market-order quoting against an aggregated YES-axis book. Shared by the trade
 * panel (live preview) and the server action (which re-quotes against fresh data).
 */

export type Level = [price: number, qty: number];
export interface Depth {
  bids: Level[]; // YES bids, best (highest) first
  asks: Level[]; // YES asks, best (lowest) first
}

/** Price levels in the outcome's own terms, best first for the given side. */
export function levelsFor(depth: Depth, outcome: "YES" | "NO", side: "BUY" | "SELL"): Level[] {
  if (outcome === "YES") return side === "BUY" ? depth.asks : depth.bids;
  // NO price = 100 - YES price. Buying NO consumes YES bids; selling NO consumes YES asks.
  const src = side === "BUY" ? depth.bids : depth.asks;
  return src.map(([p, q]) => [100 - p, q] as Level);
}

/** Best price to buy/sell the outcome right now, in ticks. */
export function bestPrice(depth: Depth, outcome: "YES" | "NO", side: "BUY" | "SELL"): number | null {
  return levelsFor(depth, outcome, side)[0]?.[0] ?? null;
}

export interface BuyQuote {
  shares: number;
  cost: number;
  worstPrice: number | null;
}

/** Spend up to `budget` ticks on whole shares, walking the book. */
export function quoteBuy(levels: Level[], budget: number): BuyQuote {
  let shares = 0;
  let cost = 0;
  let worstPrice: number | null = null;
  for (const [price, qty] of levels) {
    const afford = Math.min(qty, Math.floor((budget - cost) / price));
    if (afford <= 0) break;
    shares += afford;
    cost += afford * price;
    worstPrice = price;
    if (afford < qty) break;
  }
  return { shares, cost, worstPrice };
}

export interface SellQuote {
  shares: number;
  proceeds: number;
  worstPrice: number | null;
}

/** Sell up to `want` shares, walking the book. */
export function quoteSell(levels: Level[], want: number): SellQuote {
  let shares = 0;
  let proceeds = 0;
  let worstPrice: number | null = null;
  for (const [price, qty] of levels) {
    const take = Math.min(qty, want - shares);
    if (take <= 0) break;
    shares += take;
    proceeds += take * price;
    worstPrice = price;
  }
  return { shares, proceeds, worstPrice };
}

/** Default worst-price allowance for market orders, in cents away from the best price. */
export const DEFAULT_SLIPPAGE = 5;

/**
 * Levels a market order may touch: buys up to best + slippage, sells down to best - slippage.
 * Polymarket-style protection so one order can't sweep a thin book at absurd prices.
 */
export function capLevels(levels: Level[], side: "BUY" | "SELL", slippage: number): { levels: Level[]; cap: number | null } {
  const best = levels[0]?.[0];
  if (best == null) return { levels: [], cap: null };
  const s = Math.max(0, Math.min(98, Math.trunc(slippage)));
  const cap = side === "BUY" ? Math.min(99, best + s) : Math.max(1, best - s);
  return { levels: levels.filter(([p]) => (side === "BUY" ? p <= cap : p >= cap)), cap };
}

/** Shares held on one wedge of a wheel, and what they cost (ticks, at the average buy price). */
export interface Holding {
  wedgeId: string;
  yes: number;
  no: number;
  cost: number;
}

/**
 * Smallest and largest total payout (ticks) across the ways a wheel can settle, ignoring Moldy.
 * Binary wheels: Yes or No. Multi-outcome wheels: exactly one wedge wins, every other resolves No.
 */
export function payoutRange(holdings: Holding[], binary: boolean): { min: number; max: number } {
  if (!holdings.length) return { min: 0, max: 0 };
  const scenarios = binary
    ? [holdings[0]!.yes * 100, holdings[0]!.no * 100]
    : holdings.map((win) => holdings.reduce((s, h) => s + (h.wedgeId === win.wedgeId ? h.yes : h.no) * 100, 0));
  return { min: Math.min(...scenarios), max: Math.max(...scenarios) };
}

/** Holdings after buying `shares` of an outcome on one wedge for `cost` ticks. */
export function withBuy(holdings: Holding[], wedgeId: string, outcome: "YES" | "NO", shares: number, cost: number): Holding[] {
  return holdings.map((h) =>
    h.wedgeId !== wedgeId
      ? h
      : { ...h, yes: h.yes + (outcome === "YES" ? shares : 0), no: h.no + (outcome === "NO" ? shares : 0), cost: h.cost + cost },
  );
}
