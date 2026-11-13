/**
 * Cheddar matching engine types.
 *
 * Units: prices are integer "ticks" 1..99 (1 tick = 0.01 Latta). A winning share
 * pays 100 ticks (1 Latta). All cash amounts are integer ticks, so there is no
 * floating point anywhere in the engine.
 */

export const SHARE_VALUE = 100; // ticks paid out by a winning share
export const MIN_PRICE = 1;
export const MAX_PRICE = 99;

export type Outcome = "YES" | "NO";
export type Side = "BUY" | "SELL";
export type TimeInForce = "GTC" | "IOC";

export interface OrderInput {
  id: string;
  userId: string;
  outcome: Outcome;
  side: Side;
  /** Limit price in the order's own outcome terms (1..99 ticks). */
  price: number;
  /** Whole shares, > 0. */
  qty: number;
  tif?: TimeInForce;
}

export interface RestingOrder {
  id: string;
  userId: string;
  outcome: Outcome;
  side: Side;
  price: number;
  remaining: number;
  seq: number;
}

/**
 * One party's change from a single fill. `cash` is the change to that user's
 * spendable balance relative to what the ledger locked for the order at its
 * limit price; the ledger layer settles that difference (price improvement).
 */
export interface Leg {
  userId: string;
  orderId: string;
  outcome: Outcome;
  /** Shares gained (+) or given up (-) of `outcome`. */
  shares: number;
  /** Ticks received (+) or paid (-) in this fill. */
  cash: number;
}

export type TradeKind = "TRANSFER_YES" | "TRANSFER_NO" | "MINT" | "BURN";

export interface Trade {
  /** Execution price expressed as the YES price (NO price is 100 - this). */
  yesPrice: number;
  qty: number;
  kind: TradeKind;
  makerOrderId: string;
  takerOrderId: string;
  legs: [Leg, Leg];
}

export interface PlaceResult {
  trades: Trade[];
  /** Remaining quantity left on the book (GTC only), else undefined. */
  resting?: RestingOrder;
  /** Resting orders cancelled by self-trade prevention. */
  cancelled: RestingOrder[];
  /** Quantity not filled and not rested (IOC leftovers). */
  unfilled: number;
}
