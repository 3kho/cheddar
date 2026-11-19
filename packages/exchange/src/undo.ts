/**
 * Reversing a single trade: a Cheesemonger can reverse one specific trade (both legs) on the
 * activity page. Every leg is reversed - positions and cash go back to what they were, and any
 * order the trade filled is restored - so the market is as if that trade never happened.
 *
 * Trades already reversed carry `undone_at` and are skipped. A reversal is rejected if it would
 * drive any position negative - in that case the person has since traded those shares away and
 * the market can't be cleanly rewound without manual cleanup.
 */
import { and, eq, inArray, isNull, orders, positions, sql, tradeLegs, trades, users, wedges, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { adjustPosition, collateralAccount, Deltas, postEntry, sharesDelta, userAccounts, type UserAccounts } from "./ledger";
import { logEvent } from "./log";

export interface UndoTradeResult {
  /** The trade that was reversed. */
  tradeId: number;
  /** Users whose positions and/or cash were reversed (both parties of the trade). */
  users: string[];
}

export async function undoTrade(
  db: AnyDb,
  input: { actorId: string; tradeId: number },
  opts: { now?: () => Date } = {},
): Promise<UndoTradeResult> {
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    const [actor] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, input.actorId));
    if (!actor?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can reverse trades");

    const [trade] = await tx.select().from(trades).where(eq(trades.id, input.tradeId)).for("update");
    if (!trade) throw new ExchangeError("NOT_FOUND", "trade not found");
    if (trade.undoneAt) throw new ExchangeError("INVALID", "this trade has already been reversed");

    // All legs (both parties) of this trade.
    const legs = await tx.select().from(tradeLegs).where(eq(tradeLegs.tradeId, trade.id));
    if (!legs.length) throw new ExchangeError("NOT_FOUND", "trade has no legs");

    const wedgeId = trade.wedgeId;
    const [wedge] = await tx.select().from(wedges).where(eq(wedges.id, wedgeId)).for("update");
    if (!wedge) throw new ExchangeError("NOT_FOUND", "outcome not found");

    const orderIds = [...new Set(legs.map((l) => l.orderId))];
    const orderRows = await tx.select().from(orders).where(inArray(orders.id, orderIds)).for("update");
    const orderById = new Map(orderRows.map((o) => [o.id, o]));

    // Validate no position would go negative before mutating anything.
    const involvedUsers = [...new Set(legs.map((l) => l.userId))];
    const posRows = await tx
      .select()
      .from(positions)
      .where(and(inArray(positions.userId, involvedUsers), eq(positions.wedgeId, wedgeId)))
      .for("update");
    const posByUser = new Map(posRows.map((p) => [p.userId, p]));
    for (const leg of legs) {
      const p = posByUser.get(leg.userId);
      const yesDelta = leg.outcome === "YES" ? -leg.shares : 0;
      const noDelta = leg.outcome === "NO" ? -leg.shares : 0;
      const curYes = p?.yesShares ?? 0;
      const curNo = p?.noShares ?? 0;
      if (curYes + yesDelta < 0 || curNo + noDelta < 0) {
        throw new ExchangeError(
          "INVALID",
          "can't reverse: this person has since traded those shares away, so the position would go negative",
        );
      }
    }

    // Compute the target state for each order based on fills that remain (non-undone).
    const filledRows = await tx.execute(sql`
      SELECT l.order_id AS order_id, SUM(ABS(l.shares))::int AS filled
      FROM trade_legs l
      JOIN trades t ON t.id = l.trade_id
      WHERE l.order_id IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)}) AND t.undone_at IS NULL
      GROUP BY l.order_id
    `) as unknown as { rows: { order_id: string; filled: number }[] };
    const filledByOrder = new Map(filledRows.rows.map((r) => [r.order_id, r.filled]));

    // Per-order target locked state and the delta from current DB state.
    // Cancelled orders are left as-is — they shouldn't be relocked just because a fill is undone.
    const orderTarget = new Map<string, { remaining: number; lockedTicks: number; lockedShares: number; lockedDelta: number; lockedSharesDelta: number }>();
    for (const order of orderRows) {
      if (order.status === "cancelled") {
        orderTarget.set(order.id, { remaining: order.remaining, lockedTicks: 0, lockedShares: 0, lockedDelta: 0, lockedSharesDelta: 0 });
        continue;
      }
      const filled = filledByOrder.get(order.id) ?? 0;
      const remaining = Math.max(0, order.qty - filled);
      const targetLockedTicks = order.side === "BUY" ? order.price * remaining : 0;
      const targetLockedShares = order.side === "SELL" ? remaining : 0;
      const lockedDelta = targetLockedTicks - order.lockedTicks;
      const lockedSharesDelta = targetLockedShares - order.lockedShares;
      orderTarget.set(order.id, { remaining, lockedTicks: targetLockedTicks, lockedShares: targetLockedShares, lockedDelta, lockedSharesDelta });
    }

    const acctCache = new Map<string, UserAccounts>();
    const getAcct = async (userId: string) => {
      let a = acctCache.get(userId);
      if (!a) acctCache.set(userId, (a = await userAccounts(tx, userId)));
      return a;
    };

    const collateral = await collateralAccount(tx, wedgeId);

    const deltas = new Deltas();
    let netCash = 0;

    // Per-user locked deltas (aggregated across all their orders in this trade).
    const userLockedDelta = new Map<string, number>();

    for (const leg of legs) {
      const cash = Number(leg.cash);
      netCash += cash;
      const order = orderById.get(leg.orderId)!;
      const target = orderTarget.get(order.id)!;
      const a = await getAcct(leg.userId);

      // Cash reversal: reverse what the leg did to available.
      // Buyer: available += lockUsed + cash during fill → reverse: available -= lockUsed + cash
      // Seller: available += cash during fill → reverse: available -= cash
      // Combined with lockedDelta: net change = -cash (correct for both sides).
      const lockedDelta = target.lockedDelta;
      if (leg.shares > 0) {
        // Buyer: available -= (lockUsed + cash) for the cash part, locked handled via lockedDelta below.
        const lockUsed = order.price * leg.shares;
        deltas.add(a.available, -(lockUsed + cash));
        // Adjust available so that available + locked = -cash net:
        // available += -(lockUsed + cash) - (lockedDelta - lockUsed) = -cash - lockedDelta
        deltas.add(a.available, -(lockedDelta - lockUsed));
      } else {
        // Seller: available -= cash; locked shares handled via position delta below.
        deltas.add(a.available, -cash);
      }

      // Aggregate locked delta per user (applied to account locked for BUY orders).
      const curLocked = userLockedDelta.get(leg.userId) ?? 0;
      userLockedDelta.set(leg.userId, curLocked + lockedDelta);

      // Reverse the position change.
      // For sellers, also reverse the locked shares in the position.
      const posDelta: { yesShares?: number; noShares?: number; yesLocked?: number; noLocked?: number } =
        leg.outcome === "YES"
          ? { yesShares: -leg.shares, yesLocked: target.lockedSharesDelta }
          : { noShares: -leg.shares, noLocked: target.lockedSharesDelta };
      await adjustPosition(tx, leg.userId, wedgeId, posDelta);
    }

    // Apply aggregated per-user locked deltas to the user_locked account.
    for (const [userId, delta] of userLockedDelta) {
      if (delta !== 0) {
        const a = await getAcct(userId);
        deltas.add(a.locked, delta);
      }
    }

    // The trade's net cash moved through the collateral account; reverse it.
    deltas.add(collateral, netCash);
    await postEntry(
      tx,
      { kind: "trade", wedgeId, memo: `Trade reversed by a Cheesemonger (reverses trade ${trade.id})` },
      deltas,
    );

    // Mark the trade reversed.
    await tx.update(trades).set({ undoneAt: now, undoneBy: input.actorId }).where(eq(trades.id, trade.id));

    // Restore every order touched by the reversed trade to its target state.
    // Cancelled orders are left untouched.
    for (const order of orderRows) {
      if (order.status === "cancelled") continue;
      const target = orderTarget.get(order.id)!;
      const filledNow = target.remaining === 0;
      await tx
        .update(orders)
        .set({
          remaining: target.remaining,
          lockedTicks: target.lockedTicks,
          lockedShares: target.lockedShares,
          status: filledNow ? ("filled" as const) : ("open" as const),
          closedAt: filledNow ? now : null,
        })
        .where(eq(orders.id, order.id));
    }

    await tx.update(wedges).set({ bookVersion: wedge.bookVersion + 1 }).where(eq(wedges.id, wedgeId));

    await logEvent(tx, {
      actorId: input.actorId,
      action: "trade.reverse",
      targetType: "wedge",
      targetId: wedgeId,
      details: { tradeId: trade.id, users: involvedUsers },
    });

    return { tradeId: trade.id, users: involvedUsers };
  });
}
