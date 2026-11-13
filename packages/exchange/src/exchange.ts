import { and, asc, eq, inArray, sql } from "@cheddar/db";
import { OrderBook, MAX_PRICE, MIN_PRICE, type Outcome, type Side, type TimeInForce, type Trade } from "@cheddar/engine";
import {
  mouseFunders,
  orders,
  positions,
  tradeLegs,
  trades,
  users,
  wedges,
  wheels,
  type AnyDb,
  type Tx,
} from "@cheddar/db";
import { ExchangeError, isRetryable } from "./errors";
import { KeyedMutex } from "./mutex";
import {
  Deltas,
  adjustPosition,
  collateralAccount,
  lockedBalance,
  postEntry,
  sharesDelta,
  userAccounts,
  type UserAccounts,
} from "./ledger";

export interface PlaceOrderInput {
  userId: string;
  wedgeId: string;
  outcome: Outcome;
  side: Side;
  /** Limit price in ticks (1..99) in the order's own outcome. */
  price: number;
  qty: number;
  tif?: TimeInForce;
}

export interface PlaceOrderResult {
  orderId: string;
  status: "open" | "filled" | "cancelled";
  filled: number;
  remaining: number;
  trades: Trade[];
  /** This user's resting orders cancelled by self-trade prevention. */
  selfTradeCancelled: string[];
}

export interface ExchangeOptions {
  now?: () => Date;
  maxRetries?: number;
}

type OrderRow = typeof orders.$inferSelect;

/**
 * Transactional order service around the in-memory OrderBook.
 *
 * Every mutation of a wedge's book runs inside one DB transaction that:
 *   1. locks the wedge row (SELECT ... FOR UPDATE), serialising writers across processes,
 *   2. reloads the in-memory book if another process changed it (wedges.book_version),
 *   3. escrows collateral, matches, applies every trade leg to the ledger and positions,
 *   4. bumps book_version.
 * Within one process a per-wedge mutex avoids piling transactions onto the row lock.
 * If anything fails the transaction rolls back and the cached book is discarded.
 */
export class Exchange {
  private books = new Map<string, { book: OrderBook; version: number }>();
  private mutex = new KeyedMutex();
  private now: () => Date;
  private maxRetries: number;

  constructor(
    private db: AnyDb,
    opts: ExchangeOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.maxRetries = opts.maxRetries ?? 8;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    validateInput(input);
    return this.mutate(input.wedgeId, (tx) => this.placeInTx(tx, input));
  }

  async cancelOrder(userId: string, orderId: string): Promise<void> {
    const [row] = await this.db.select({ wedgeId: orders.wedgeId }).from(orders).where(eq(orders.id, orderId));
    if (!row) throw new ExchangeError("NOT_FOUND", "order not found");
    await this.mutate(row.wedgeId, async (tx) => {
      const version = await this.lockWedge(tx, row.wedgeId);
      const book = await this.bookFor(tx, row.wedgeId, version.bookVersion);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order || order.userId !== userId) throw new ExchangeError("NOT_FOUND", "order not found");
      if (order.status !== "open") throw new ExchangeError("INVALID", `order is already ${order.status}`);
      book.cancel(orderId);
      await releaseOrder(tx, order, "user_cancelled", this.now());
      await this.bumpVersion(tx, row.wedgeId, version.bookVersion, undefined);
    });
  }

  /**
   * Replace all of a user's open orders on a wedge with a new set, in one transaction under the
   * wedge lock (this is how The Mouse re-quotes). `build` gets the user's current shares and returns
   * the orders to place; if they equal the open ones nothing changes. Before any BUY is placed,
   * `fund` is called with the escrow they need (The Mouse tops up from the house there).
   * New orders that cross other people's resting orders trade immediately, as usual.
   * When the wedge isn't tradable it just cancels.
   */
  async replaceOrders(
    userId: string,
    wedgeId: string,
    build: (held: { yes: number; no: number }) => { outcome: Outcome; side: Side; price: number; qty: number }[],
    fund?: (tx: Tx, ticks: number) => Promise<unknown>,
  ): Promise<{ changed: boolean; cancelled: number; placed: number; trades: number }> {
    return this.mutate(wedgeId, async (tx) => {
      const now = this.now();
      const w = await this.lockWedge(tx, wedgeId);
      const tradable =
        w.status === "open" && w.wheelStatus === "open" && !w.pausedAt && !(w.closesAt && w.closesAt <= now);
      const [pos] = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.wedgeId, wedgeId)))
        .for("update");
      const wanted = tradable
        ? build({ yes: pos?.yesShares ?? 0, no: pos?.noShares ?? 0 }).filter((o) => o.qty > 0 && o.price >= MIN_PRICE && o.price <= MAX_PRICE)
        : [];
      const open = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.wedgeId, wedgeId), eq(orders.userId, userId), eq(orders.status, "open")))
        .for("update");
      const key = (o: { outcome: string; side: string; price: number }, qty: number) => `${o.outcome}:${o.side}:${o.price}:${qty}`;
      const have = open.map((o) => key(o, o.remaining)).sort();
      const want = wanted.map((o) => key(o, o.qty)).sort();
      if (have.length === want.length && have.every((k, i) => k === want[i])) {
        return { changed: false, cancelled: 0, placed: 0, trades: 0 };
      }

      if (open.length) {
        const book = await this.bookFor(tx, wedgeId, w.bookVersion);
        for (const o of open) {
          book.cancel(o.id);
          await releaseOrder(tx, o, "requote", now);
        }
        await this.bumpVersion(tx, wedgeId, w.bookVersion, undefined);
      }
      if (!wanted.length) return { changed: true, cancelled: open.length, placed: 0, trades: 0 };

      const escrow = wanted.filter((o) => o.side === "BUY").reduce((s, o) => s + o.price * o.qty, 0);
      if (fund && escrow > 0) await fund(tx, escrow);
      let trades = 0;
      for (const o of wanted) {
        const r = await this.placeInTx(tx, { userId, wedgeId, outcome: o.outcome, side: o.side, price: o.price, qty: o.qty });
        trades += r.trades.length;
      }
      return { changed: true, cancelled: open.length, placed: wanted.length, trades };
    });
  }

  /** Aggregated depth on the YES price axis, best first. */
  async depth(wedgeId: string) {
    return this.mutate(wedgeId, async (tx) => {
      const [w] = await tx.select({ v: wedges.bookVersion }).from(wedges).where(eq(wedges.id, wedgeId));
      if (!w) throw new ExchangeError("NOT_FOUND", "wedge not found");
      return (await this.bookFor(tx, wedgeId, w.v)).depth();
    });
  }

  /** Rebuild every book that has open orders (call on engine startup). */
  async warmUp(): Promise<number> {
    const ids = await this.db.selectDistinct({ id: orders.wedgeId }).from(orders).where(eq(orders.status, "open"));
    for (const { id } of ids) await this.depth(id);
    return ids.length;
  }

  // ---------- internals ----------

  private mutate<T>(wedgeId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.mutex.run(wedgeId, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.db.transaction(fn);
        } catch (e) {
          this.books.delete(wedgeId); // the in-memory book may be ahead of the rolled-back DB
          if (attempt < this.maxRetries && isRetryable(e)) continue;
          throw e;
        }
      }
    });
  }

  private async lockWedge(tx: Tx, wedgeId: string) {
    const [w] = await tx
      .select({
        bookVersion: wedges.bookVersion,
        status: wedges.status,
        wheelStatus: wheels.status,
        closesAt: wheels.closesAt,
        pausedAt: wheels.tradingPausedAt,
        pauseReason: wheels.pauseReason,
      })
      .from(wedges)
      .innerJoin(wheels, eq(wheels.id, wedges.wheelId))
      .where(eq(wedges.id, wedgeId))
      .for("update", { of: wedges });
    if (!w) throw new ExchangeError("NOT_FOUND", "wedge not found");
    return w;
  }

  private async bookFor(tx: Tx, wedgeId: string, version: number): Promise<OrderBook> {
    const cached = this.books.get(wedgeId);
    if (cached && cached.version === version) return cached.book;
    const open = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.wedgeId, wedgeId), eq(orders.status, "open")))
      .orderBy(asc(orders.seq));
    const book = new OrderBook();
    for (const o of open) {
      const r = book.place({ id: o.id, userId: o.userId, outcome: o.outcome, side: o.side, price: o.price, qty: o.remaining });
      if (r.trades.length || r.cancelled.length) throw new Error(`stored book for wedge ${wedgeId} is crossed`);
    }
    this.books.set(wedgeId, { book, version });
    return book;
  }

  private async bumpVersion(tx: Tx, wedgeId: string, version: number, lastYesPrice: number | undefined) {
    await tx
      .update(wedges)
      .set({ bookVersion: version + 1, ...(lastYesPrice !== undefined ? { lastYesPrice } : {}) })
      .where(eq(wedges.id, wedgeId));
    const cached = this.books.get(wedgeId);
    if (cached) cached.version = version + 1; // discarded by mutate() if the commit fails
  }

  private async placeInTx(tx: Tx, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const now = this.now();
    const w = await this.lockWedge(tx, input.wedgeId);
    if (w.status !== "open" || w.wheelStatus !== "open" || (w.closesAt && w.closesAt <= now)) {
      throw new ExchangeError("MARKET_CLOSED", "this wedge is not open for trading");
    }
    if (w.pausedAt) {
      throw new ExchangeError("MARKET_CLOSED", `trading is paused by the Cheesemongers${w.pauseReason ? ": " + w.pauseReason : ""}`);
    }
    await assertCanTrade(tx, input.userId);
    const book = await this.bookFor(tx, input.wedgeId, w.bookVersion);
    const acctCache = new Map<string, UserAccounts>();
    const acct = async (userId: string) => {
      let a = acctCache.get(userId);
      if (!a) acctCache.set(userId, (a = await userAccounts(tx, userId)));
      return a;
    };

    // 1. Escrow: cash at the limit price for buys, shares for sells.
    const mine = await acct(input.userId);
    let lockedTicks = 0;
    let lockedShares = 0;
    if (input.side === "BUY") {
      lockedTicks = input.price * input.qty;
      if ((await lockedBalance(tx, mine.available)) < lockedTicks) {
        throw new ExchangeError("INSUFFICIENT_FUNDS", "not enough Latta for this order");
      }
    } else {
      const [pos] = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.userId, input.userId), eq(positions.wedgeId, input.wedgeId)))
        .for("update");
      const free = !pos
        ? 0
        : input.outcome === "YES"
          ? pos.yesShares - pos.yesLocked
          : pos.noShares - pos.noLocked;
      if (free < input.qty) throw new ExchangeError("INSUFFICIENT_SHARES", "not enough shares to sell");
      lockedShares = input.qty;
    }

    const [taker] = await tx
      .insert(orders)
      .values({
        userId: input.userId,
        wedgeId: input.wedgeId,
        outcome: input.outcome,
        side: input.side,
        tif: input.tif ?? "GTC",
        price: input.price,
        qty: input.qty,
        remaining: input.qty,
        lockedTicks,
        lockedShares,
      })
      .returning();
    if (lockedTicks > 0) {
      await postEntry(
        tx,
        { kind: "order_lock", userId: input.userId, wedgeId: input.wedgeId, orderId: taker!.id },
        new Deltas().add(mine.available, -lockedTicks).add(mine.locked, lockedTicks),
      );
    } else {
      await adjustPosition(tx, input.userId, input.wedgeId, sharesDelta(input.outcome, 0, lockedShares));
    }

    // 2. Match.
    const result = book.place({
      id: taker!.id,
      userId: input.userId,
      outcome: input.outcome,
      side: input.side,
      price: input.price,
      qty: input.qty,
      tif: input.tif,
    });

    // 3. Self-trade prevention cancelled some of this user's resting orders.
    if (result.cancelled.length) {
      const rows = await tx
        .select()
        .from(orders)
        .where(inArray(orders.id, result.cancelled.map((c) => c.id)))
        .for("update");
      for (const r of rows) await releaseOrder(tx, r, "self_trade", now);
    }

    // 4. Apply trades.
    const live = new Map<string, OrderRow>([[taker!.id, taker!]]);
    const makerIds = [...new Set(result.trades.map((t) => t.makerOrderId))];
    if (makerIds.length) {
      const rows = await tx.select().from(orders).where(inArray(orders.id, makerIds)).for("update");
      for (const r of rows) live.set(r.id, r);
    }
    const collateral = result.trades.length ? await collateralAccount(tx, input.wedgeId) : "";

    for (const t of result.trades) {
      const deltas = new Deltas();
      let netCash = 0;
      for (const leg of t.legs) {
        const o = live.get(leg.orderId)!;
        const a = await acct(leg.userId);
        const q = Math.abs(leg.shares);
        netCash += leg.cash;
        if (leg.shares > 0) {
          // Buyer: release the escrow for these shares, pay the execution price, refund the rest.
          const lockUsed = o.price * q;
          deltas.add(a.locked, -lockUsed).add(a.available, lockUsed + leg.cash);
          o.lockedTicks -= lockUsed;
          await adjustPosition(tx, leg.userId, input.wedgeId, sharesDelta(leg.outcome, q, 0));
        } else {
          // Seller: hand over the reserved shares, receive cash.
          deltas.add(a.available, leg.cash);
          o.lockedShares -= q;
          await adjustPosition(tx, leg.userId, input.wedgeId, sharesDelta(leg.outcome, -q, -q));
        }
        o.remaining -= q;
      }
      // MINT pays 100/pair into collateral, BURN pays it out, transfers net to 0.
      if (netCash !== 0) deltas.add(collateral, -netCash);
      const entryId = await postEntry(tx, { kind: "trade", wedgeId: input.wedgeId, orderId: taker!.id }, deltas);
      const [trade] = await tx
        .insert(trades)
        .values({
          wedgeId: input.wedgeId,
          kind: t.kind,
          yesPrice: t.yesPrice,
          qty: t.qty,
          makerOrderId: t.makerOrderId,
          takerOrderId: t.takerOrderId,
          journalEntryId: entryId!,
        })
        .returning({ id: trades.id });
      await tx.insert(tradeLegs).values(t.legs.map((l) => ({ tradeId: trade!.id, ...l })));
    }

    // 5. Persist order states.
    for (const id of makerIds) {
      const o = live.get(id)!;
      await tx
        .update(orders)
        .set({
          remaining: o.remaining,
          lockedTicks: o.lockedTicks,
          lockedShares: o.lockedShares,
          ...(o.remaining === 0 ? { status: "filled" as const, closedAt: now } : {}),
        })
        .where(eq(orders.id, id));
    }
    const t = live.get(taker!.id)!;
    let status: PlaceOrderResult["status"];
    if (t.remaining === 0) {
      status = "filled";
      await tx
        .update(orders)
        .set({ remaining: 0, lockedTicks: t.lockedTicks, lockedShares: t.lockedShares, status, closedAt: now })
        .where(eq(orders.id, t.id));
    } else if (result.resting) {
      status = "open";
      await tx
        .update(orders)
        .set({ remaining: t.remaining, lockedTicks: t.lockedTicks, lockedShares: t.lockedShares })
        .where(eq(orders.id, t.id));
    } else {
      status = "cancelled"; // IOC leftover
      await tx.update(orders).set({ remaining: t.remaining }).where(eq(orders.id, t.id));
      await releaseOrder(tx, { ...t }, "ioc_unfilled", now);
    }

    const last = result.trades[result.trades.length - 1];
    await this.bumpVersion(tx, input.wedgeId, w.bookVersion, last?.yesPrice);

    return {
      orderId: t.id,
      status,
      filled: input.qty - t.remaining,
      remaining: status === "open" ? t.remaining : 0,
      trades: result.trades,
      selfTradeCancelled: result.cancelled.map((c) => c.id),
    };
  }
}

function validateInput(i: PlaceOrderInput) {
  if (!Number.isInteger(i.price) || i.price < MIN_PRICE || i.price > MAX_PRICE) {
    throw new ExchangeError("INVALID", `price must be a whole number of ticks ${MIN_PRICE}..${MAX_PRICE}`);
  }
  if (!Number.isInteger(i.qty) || i.qty <= 0 || i.qty > 1_000_000) {
    throw new ExchangeError("INVALID", "quantity must be a whole number of shares between 1 and 1,000,000");
  }
}

export async function assertCanTrade(tx: Tx, userId: string) {
  const [u] = await tx
    .select({
      id: users.id,
      isBot: users.isBot,
      botRole: users.botRole,
      suspendedAt: users.suspendedAt,
      funder: mouseFunders.slackId,
    })
    .from(users)
    .leftJoin(mouseFunders, and(eq(mouseFunders.slackId, users.slackId), eq(mouseFunders.active, true)))
    .where(eq(users.id, userId))
    // Share lock: waits for (and then sees) a concurrent Mouse-funder sweep or suspension of this user.
    .for("share", { of: users });
  if (!u) throw new ExchangeError("NOT_FOUND", "user not found");
  if (u.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
  if (u.funder) throw new ExchangeError("FORBIDDEN", "Mouse funders can view Cheddar but not trade");
  if (u.isBot && u.botRole !== "mouse") throw new ExchangeError("FORBIDDEN", "this bot cannot trade");
}

/**
 * Cancel every open order a user has, returning all escrow. Locks the affected wedges in id
 * order (and bumps their book versions so cached books reload). Caller must hold the user's
 * row lock (FOR UPDATE), which blocks new orders from that user until commit.
 * With alsoPositions, wedges where the user merely holds shares are locked too.
 */
export async function cancelUserOrders(
  tx: Tx,
  userId: string,
  reason: string,
  now: Date,
  opts: { alsoPositions?: boolean } = {},
): Promise<{ cancelled: number; wedgeIds: string[] }> {
  const touched = (await tx.execute(sql`
    SELECT DISTINCT w.id FROM wedges w
    WHERE w.status IN ('open', 'halted') AND (
      EXISTS (SELECT 1 FROM orders o WHERE o.wedge_id = w.id AND o.user_id = ${userId} AND o.status = 'open')
      OR (${!!opts.alsoPositions} AND EXISTS (
        SELECT 1 FROM positions p WHERE p.wedge_id = w.id AND p.user_id = ${userId} AND (p.yes_shares > 0 OR p.no_shares > 0)))
    )
    ORDER BY w.id
  `)) as unknown as { rows: { id: string }[] };
  const wedgeIds = touched.rows.map((r) => r.id);
  if (!wedgeIds.length) return { cancelled: 0, wedgeIds };
  const locked = await tx.select().from(wedges).where(inArray(wedges.id, wedgeIds)).orderBy(wedges.id).for("update");
  const open = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, "open"), inArray(orders.wedgeId, wedgeIds)))
    .for("update");
  for (const o of open) await releaseOrder(tx, o, reason, now);
  for (const w of locked) await tx.update(wedges).set({ bookVersion: w.bookVersion + 1 }).where(eq(wedges.id, w.id));
  return { cancelled: open.length, wedgeIds };
}

/** Cancel an order and return everything it still has escrowed. Caller must hold the wedge lock. */
export async function releaseOrder(tx: Tx, o: OrderRow, reason: string, now: Date) {
  if (o.side === "BUY" && o.lockedTicks > 0) {
    const a = await userAccounts(tx, o.userId);
    await postEntry(
      tx,
      { kind: "order_release", userId: o.userId, wedgeId: o.wedgeId, orderId: o.id, memo: reason },
      new Deltas().add(a.locked, -o.lockedTicks).add(a.available, o.lockedTicks),
    );
  }
  if (o.side === "SELL" && o.lockedShares > 0) {
    await adjustPosition(tx, o.userId, o.wedgeId, sharesDelta(o.outcome, 0, -o.lockedShares));
  }
  await tx
    .update(orders)
    .set({ status: "cancelled", cancelReason: reason, closedAt: now, lockedTicks: 0, lockedShares: 0 })
    .where(eq(orders.id, o.id));
}
