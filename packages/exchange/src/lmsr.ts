/**
 * The Mouse's pricing: a logarithmic market scoring rule (LMSR) over a whole wheel.
 *
 * A wheel's outcomes are its wedges (exactly one wins), or YES/NO for a binary wheel. The LMSR
 * state is q_k = anchor_k - P_k, where P_k is what The Mouse's shares pay (in shares) if
 * outcome k wins. Prices are softmax(q / b) and always sum to 1, which is what links the
 * outcomes: a trade on one wedge moves every other wedge's price.
 *
 * Deriving q from The Mouse's real inventory keeps this stateless: whatever happened (fills,
 * conversions, settlements), the next quote is right. Riskless bundles (a YES/NO pair, YES on
 * every wedge, NO on every wedge) add the same amount to every P_k, so they never move prices.
 *
 * The Mouse turns the curve into ordinary limit orders: at each cent above the price it offers
 * the shares the LMSR would sell between that cent and the one below, and the same below the
 * price for buying. Pure functions; no database.
 */

export interface Holding {
  /** Total shares The Mouse holds on the wedge (including ones reserved by its own sells). */
  yes: number;
  no: number;
}

/** Outcome keys in a fixed order: wedge ids, or ["YES", "NO"] for a binary wheel. */
export function outcomeKeys(wedgeIds: string[]): string[] {
  return wedgeIds.length === 1 ? ["YES", "NO"] : wedgeIds;
}

/** What The Mouse's shares pay, in shares, for each outcome in `outcomeKeys` order. */
export function payoffs(wedgeIds: string[], holdings: Map<string, Holding>): number[] {
  if (wedgeIds.length === 1) {
    const h = holdings.get(wedgeIds[0]!) ?? { yes: 0, no: 0 };
    return [h.yes, h.no];
  }
  const totalNo = wedgeIds.reduce((s, id) => s + (holdings.get(id)?.no ?? 0), 0);
  return wedgeIds.map((id) => {
    const h = holdings.get(id) ?? { yes: 0, no: 0 };
    return h.yes + totalNo - h.no;
  });
}

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
}

export function stateFor(anchor: number[], payoff: number[]): number[] {
  return anchor.map((a, k) => a - payoff[k]!);
}

/** Outcome probabilities (0..1) from an LMSR state. */
export function prices(q: number[], b: number): number[] {
  const z = q.map((x) => x / b);
  const lse = logSumExp(z);
  return z.map((x) => Math.exp(x - lse));
}

/** An anchor that makes the current inventory quote exactly `probs` (normalised, clamped). */
export function anchorFor(probs: number[], payoff: number[], b: number): number[] {
  const clamped = probs.map((p) => Math.min(0.98, Math.max(0.01, Number.isFinite(p) ? p : 0)));
  const total = clamped.reduce((s, p) => s + p, 0);
  return clamped.map((p, k) => b * Math.log(p / total) + payoff[k]!);
}

export interface Level {
  /** Price in cents of the wedge's YES. */
  price: number;
  qty: number;
}

/**
 * The ladder for one wedge: asks (The Mouse sells YES, best first) and bids (it buys YES).
 * `i` is the wedge's index in `outcomeKeys` (always 0, YES, for a binary wheel).
 */
export function ladder(q: number[], b: number, i: number, levels: number): { asks: Level[]; bids: Level[] } {
  const qi = q[i]!;
  const others = q.filter((_, j) => j !== i).map((x) => x / b);
  const lnS = logSumExp(others);
  const p0 = prices(q, b)[i]!;
  // Shares of outcome i The Mouse sells (+) or buys (-) to move its price from p0 to t.
  const delta = (t: number) => b * (Math.log(t / (1 - t)) + lnS) - qi;

  const asks: Level[] = [];
  let prev = 0;
  for (let c = Math.floor(p0 * 100) + 1; c <= 99 && asks.length < levels; c++) {
    const cum = Math.floor(delta(c / 100) + 1e-9);
    if (cum - prev > 0) asks.push({ price: c, qty: cum - prev });
    prev = Math.max(prev, cum);
  }
  const bids: Level[] = [];
  prev = 0;
  for (let c = Math.ceil(p0 * 100) - 1; c >= 1 && bids.length < levels; c--) {
    const cum = Math.floor(-delta(c / 100) + 1e-9);
    if (cum - prev > 0) bids.push({ price: c, qty: cum - prev });
    prev = Math.max(prev, cum);
  }
  return { asks, bids };
}

export interface OrderSpec {
  outcome: "YES" | "NO";
  side: "BUY" | "SELL";
  /** In the order's own outcome terms. */
  price: number;
  qty: number;
}

/**
 * Turn a ladder into orders, selling inventory The Mouse already holds before minting new pairs:
 * an ask sells held YES (else buys NO at 100 - price); a bid sells held NO (else buys YES).
 */
export function ordersFor(l: { asks: Level[]; bids: Level[] }, held: Holding): OrderSpec[] {
  const out: OrderSpec[] = [];
  let yes = held.yes;
  let no = held.no;
  for (const a of l.asks) {
    const sell = Math.min(yes, a.qty);
    if (sell > 0) out.push({ outcome: "YES", side: "SELL", price: a.price, qty: sell });
    if (a.qty - sell > 0) out.push({ outcome: "NO", side: "BUY", price: 100 - a.price, qty: a.qty - sell });
    yes -= sell;
  }
  for (const bd of l.bids) {
    const sell = Math.min(no, bd.qty);
    if (sell > 0) out.push({ outcome: "NO", side: "SELL", price: 100 - bd.price, qty: sell });
    if (bd.qty - sell > 0) out.push({ outcome: "YES", side: "BUY", price: bd.price, qty: bd.qty - sell });
    no -= sell;
  }
  return out;
}

/** Worst case The Mouse can lose on a wheel (ticks): b * ln(outcomes) Latta. */
export function maxLossTicks(b: number, outcomes: number): number {
  return Math.round(b * Math.log(Math.max(2, outcomes)) * 100);
}
