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

    const acctCache = new Map<string, UserAccounts>();
    const getAcct = async (userId: string) => {
      let a = acctCache.get(userId);
      if (!a) acctCache.set(userId, (a = await userAccounts(tx, userId)));
      return a;
    };

    const collateral = await collateralAccount(tx, wedgeId);

    const deltas = new Deltas();
    let netCash = 0;
    for (const leg of legs) {
      const cash = Number(leg.cash);
      netCash += cash;
      const order = orderById.get(leg.orderId)!;
      const a = await getAcct(leg.userId);
      if (leg.shares > 0) {
        // Buyer: at fill they got their escrow back and paid the execution price. Reverse both.
        const lockUsed = order.price * leg.shares;
        deltas.add(a.available, -(lockUsed + cash));
        deltas.add(a.locked, lockUsed);
      } else {
        // Seller: at fill they received cash. Reverse it.
        deltas.add(a.available, -cash);
      }
      // Reverse the position change. Locked shares net to zero across placement+fill for sellers,
      // and buyers never lock shares, so only the signed share change needs undoing.
      await adjustPosition(tx, leg.userId, wedgeId, sharesDelta(leg.outcome, -leg.shares, 0));
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

    // Restore every order touched by the reversed trade: recompute remaining from the fills that
    // remain (everything not just undone), then reflect the open portion in the order row.
    const filledRows = await tx.execute(sql`
      SELECT l.order_id AS order_id, SUM(ABS(l.shares))::int AS filled
      FROM trade_legs l
      JOIN trades t ON t.id = l.trade_id
      WHERE l.order_id IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)}) AND t.undone_at IS NULL
      GROUP BY l.order_id
    `) as unknown as { rows: { order_id: string; filled: number }[] };
    const filledByOrder = new Map(filledRows.rows.map((r) => [r.order_id, r.filled]));

    for (const order of orderRows) {
      const filled = filledByOrder.get(order.id) ?? 0;
      const remaining = Math.max(0, order.qty - filled);
      const lockedTicks = order.side === "BUY" ? order.price * remaining : 0;
      const lockedShares = order.side === "SELL" ? remaining : 0;
      const filledNow = remaining === 0;
      await tx
        .update(orders)
        .set({
          remaining,
          lockedTicks,
          lockedShares,
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
