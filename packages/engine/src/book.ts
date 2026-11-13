import {
  MAX_PRICE,
  MIN_PRICE,
  SHARE_VALUE,
  type Leg,
  type OrderInput,
  type PlaceResult,
  type RestingOrder,
  type Trade,
  type TradeKind,
} from "./types";

/**
 * A single binary market's order book, normalised to the YES price axis.
 *
 *   BUY  YES @ p  ->  bid at p
 *   SELL YES @ p  ->  ask at p
 *   BUY  NO  @ p  ->  ask at 100 - p   (mints a YES/NO pair when it matches a bid)
 *   SELL NO  @ p  ->  bid at 100 - p   (burns a pair when it matches an ask)
 *
 * Matching: price-time priority; trades execute at the resting order's price.
 * Self-trade prevention: the resting order is cancelled.
 */

interface Entry {
  order: RestingOrder;
  yesPrice: number;
}

function toYesPrice(o: { outcome: "YES" | "NO"; price: number }): number {
  return o.outcome === "YES" ? o.price : SHARE_VALUE - o.price;
}

/** true if this order sits on the bid side of the YES axis */
function isBid(o: { outcome: "YES" | "NO"; side: "BUY" | "SELL" }): boolean {
  return (o.outcome === "YES" && o.side === "BUY") || (o.outcome === "NO" && o.side === "SELL");
}

export class OrderBook {
  private bids: Entry[] = []; // best (highest) first
  private asks: Entry[] = []; // best (lowest) first
  private byId = new Map<string, Entry>();
  private seq = 0;

  place(input: OrderInput): PlaceResult {
    validate(input);
    if (this.byId.has(input.id)) throw new Error(`duplicate order id ${input.id}`);

    const taker: RestingOrder = {
      id: input.id,
      userId: input.userId,
      outcome: input.outcome,
      side: input.side,
      price: input.price,
      remaining: input.qty,
      seq: ++this.seq,
    };
    const takerIsBid = isBid(taker);
    const takerYes = toYesPrice(taker);
    const trades: Trade[] = [];
    const cancelled: RestingOrder[] = [];

    const opposite = takerIsBid ? this.asks : this.bids;
    while (taker.remaining > 0 && opposite.length > 0) {
      const best = opposite[0]!;
      const crosses = takerIsBid ? best.yesPrice <= takerYes : best.yesPrice >= takerYes;
      if (!crosses) break;

      if (best.order.userId === taker.userId) {
        opposite.shift();
        this.byId.delete(best.order.id);
        cancelled.push(best.order);
        continue;
      }

      const qty = Math.min(taker.remaining, best.order.remaining);
      const bidOrder = takerIsBid ? taker : best.order;
      const askOrder = takerIsBid ? best.order : taker;
      trades.push(buildTrade(bidOrder, askOrder, best.yesPrice, qty, best.order.id, taker.id));

      taker.remaining -= qty;
      best.order.remaining -= qty;
      if (best.order.remaining === 0) {
        opposite.shift();
        this.byId.delete(best.order.id);
      }
    }

    let resting: RestingOrder | undefined;
    let unfilled = 0;
    if (taker.remaining > 0) {
      if ((input.tif ?? "GTC") === "GTC") {
        const entry: Entry = { order: taker, yesPrice: takerYes };
        insert(takerIsBid ? this.bids : this.asks, entry, takerIsBid);
        this.byId.set(taker.id, entry);
        resting = { ...taker };
      } else {
        unfilled = taker.remaining;
      }
    }
    return { trades, resting, cancelled, unfilled };
  }

  cancel(orderId: string): RestingOrder | undefined {
    const entry = this.byId.get(orderId);
    if (!entry) return undefined;
    const list = isBid(entry.order) ? this.bids : this.asks;
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
    this.byId.delete(orderId);
    return entry.order;
  }

  /** Best bid / ask on the YES axis. */
  bestBid(): number | undefined {
    return this.bids[0]?.yesPrice;
  }
  bestAsk(): number | undefined {
    return this.asks[0]?.yesPrice;
  }

  /** Aggregated depth on the YES axis, best first. */
  depth(): { bids: [number, number][]; asks: [number, number][] } {
    return { bids: aggregate(this.bids), asks: aggregate(this.asks) };
  }

  get(orderId: string): RestingOrder | undefined {
    const e = this.byId.get(orderId);
    return e ? { ...e.order } : undefined;
  }

  openOrders(): RestingOrder[] {
    return [...this.byId.values()].map((e) => ({ ...e.order }));
  }
}

function validate(o: OrderInput): void {
  if (!Number.isInteger(o.price) || o.price < MIN_PRICE || o.price > MAX_PRICE) {
    throw new Error(`price must be an integer ${MIN_PRICE}..${MAX_PRICE}`);
  }
  if (!Number.isInteger(o.qty) || o.qty <= 0) throw new Error("qty must be a positive integer");
}

function insert(list: Entry[], entry: Entry, bidSide: boolean): void {
  // Keep best-first; equal prices stay in arrival order (time priority).
  let i = list.length;
  while (
    i > 0 &&
    (bidSide ? list[i - 1]!.yesPrice < entry.yesPrice : list[i - 1]!.yesPrice > entry.yesPrice)
  ) {
    i--;
  }
  list.splice(i, 0, entry);
}

function aggregate(list: Entry[]): [number, number][] {
  const out: [number, number][] = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last[0] === e.yesPrice) last[1] += e.order.remaining;
    else out.push([e.yesPrice, e.order.remaining]);
  }
  return out;
}

function buildTrade(
  bid: RestingOrder,
  ask: RestingOrder,
  t: number,
  qty: number,
  makerOrderId: string,
  takerOrderId: string,
): Trade {
  const yes = t * qty;
  const no = (SHARE_VALUE - t) * qty;
  let kind: TradeKind;
  let bidLeg: Leg;
  let askLeg: Leg;

  const bidIsBuyYes = bid.outcome === "YES"; // else SELL NO
  const askIsSellYes = ask.outcome === "YES"; // else BUY NO

  if (bidIsBuyYes && askIsSellYes) {
    kind = "TRANSFER_YES";
    bidLeg = leg(bid, "YES", +qty, -yes);
    askLeg = leg(ask, "YES", -qty, +yes);
  } else if (bidIsBuyYes && !askIsSellYes) {
    kind = "MINT";
    bidLeg = leg(bid, "YES", +qty, -yes);
    askLeg = leg(ask, "NO", +qty, -no);
  } else if (!bidIsBuyYes && askIsSellYes) {
    kind = "BURN";
    bidLeg = leg(bid, "NO", -qty, +no);
    askLeg = leg(ask, "YES", -qty, +yes);
  } else {
    kind = "TRANSFER_NO";
    bidLeg = leg(bid, "NO", -qty, +no);
    askLeg = leg(ask, "NO", +qty, -no);
  }
  return { yesPrice: t, qty, kind, makerOrderId, takerOrderId, legs: [bidLeg, askLeg] };
}

function leg(o: RestingOrder, outcome: "YES" | "NO", shares: number, cash: number): Leg {
  return { userId: o.userId, orderId: o.id, outcome, shares, cash };
}
