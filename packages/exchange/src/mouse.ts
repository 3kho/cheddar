/**
 * The Mouse as a market maker. For every open wheel with liquidity > 0 it quotes an LMSR ladder
 * (see lmsr.ts) on each wedge, so there is always someone on the other side and big orders move
 * the price instead of running out. Call requoteWheel after anything that changes a wheel's
 * book or The Mouse's inventory; it is cheap when nothing changed.
 *
 * Funding: The Mouse spends its own cash (fed by Mouse funders' coding hours) first, then the
 * house lends it the rest (house.ts), and it repays the house whenever it has spare cash.
 */
import { and, asc, eq, gt, inArray, orders, positions, users, wedges, wheels, type AnyDb } from "@cheddar/db";
import { ensureMouse } from "./churn";
import { ExchangeError, runTx } from "./errors";
import type { Exchange } from "./exchange";
import { ensureCash, repayHouse } from "./house";
import { logEvent } from "./log";
import { anchorFor, ladder, ordersFor, outcomeKeys, payoffs, prices, stateFor, type Holding } from "./lmsr";

/** Price levels quoted on each side of each wedge. */
export const MOUSE_LEVELS = 8;
export const MAX_LIQUIDITY = 1_000_000;

async function wheelState(db: AnyDb, wheelId: string, mouseId: string) {
  const [w] = await db.select().from(wheels).where(eq(wheels.id, wheelId));
  if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
  const ws = await db.select().from(wedges).where(eq(wedges.wheelId, wheelId)).orderBy(asc(wedges.sortOrder), asc(wedges.createdAt));
  const ids = ws.map((x) => x.id);
  const pos = ids.length
    ? await db.select().from(positions).where(and(eq(positions.userId, mouseId), inArray(positions.wedgeId, ids)))
    : [];
  const holdings = new Map<string, Holding>(pos.map((p) => [p.wedgeId, { yes: p.yesShares, no: p.noShares }]));
  return { wheel: w, wedges: ws, ids, holdings };
}

/** The Mouse's current prices for a wheel (0..1 per outcome key), or null if it isn't quoting. */
export function mousePrices(
  wheel: { liquidity: number; mmAnchor: Record<string, number> | null },
  ids: string[],
  holdings: Map<string, Holding>,
): Map<string, number> | null {
  if (!wheel.liquidity || !wheel.mmAnchor) return null;
  const keys = outcomeKeys(ids);
  const anchor = keys.map((k) => wheel.mmAnchor![k] ?? 0);
  const p = prices(stateFor(anchor, payoffs(ids, holdings)), wheel.liquidity);
  return new Map(keys.map((k, i) => [k, p[i]!]));
}

/**
 * Re-quote The Mouse on every wedge of a wheel. Cancels its quotes when the wheel isn't tradable
 * (paused, ripening, settled, liquidity 0), then repays the house from any spare cash.
 * A proposed outcome does not change the wheel's status, so quotes stay up until approval.
 */
export async function requoteWheel(db: AnyDb, exchange: Exchange, wheelId: string) {
  const mouse = await ensureMouse(db);
  const { wheel, wedges: ws, ids, holdings } = await wheelState(db, wheelId, mouse.id);
  const now = new Date();
  const live =
    wheel.status === "open" && !wheel.tradingPausedAt && wheel.liquidity > 0 && !!wheel.mmAnchor && !(wheel.closesAt && wheel.closesAt <= now);

  let trades = 0;
  let changed = 0;
  if (!live) {
    const withOrders = ids.length
      ? await db
          .selectDistinct({ id: orders.wedgeId })
          .from(orders)
          .where(and(eq(orders.userId, mouse.id), eq(orders.status, "open"), inArray(orders.wedgeId, ids)))
      : [];
    for (const { id } of withOrders) {
      const r = await exchange.replaceOrders(mouse.id, id, () => []);
      if (r.changed) changed++;
    }
  } else {
    const keys = outcomeKeys(ids);
    const anchor = keys.map((k) => wheel.mmAnchor![k] ?? 0);
    const q = stateFor(anchor, payoffs(ids, holdings));
    for (let i = 0; i < ws.length; i++) {
      const wedge = ws[i]!;
      if (wedge.status !== "open") continue;
      const l = ladder(q, wheel.liquidity, ids.length === 1 ? 0 : i, MOUSE_LEVELS);
      const r = await exchange.replaceOrders(
        mouse.id,
        wedge.id,
        (held) => ordersFor(l, held),
        (tx, need) => ensureCash(tx, mouse.id, need),
      );
      trades += r.trades;
      if (r.changed) changed++;
    }
  }
  await runTx(db, (tx) => repayHouse(tx, mouse.id));
  return { live, changed, trades };
}

/** Wheels The Mouse should look at: quoting ones, and any where it still has orders resting. */
export async function mouseWheelIds(db: AnyDb): Promise<string[]> {
  const mouse = await ensureMouse(db);
  const quoting = await db
    .select({ id: wheels.id })
    .from(wheels)
    .where(and(eq(wheels.status, "open"), gt(wheels.liquidity, 0)));
  const resting = await db
    .selectDistinct({ id: wedges.wheelId })
    .from(orders)
    .innerJoin(wedges, eq(wedges.id, orders.wedgeId))
    .where(and(eq(orders.userId, mouse.id), eq(orders.status, "open")));
  return [...new Set([...quoting.map((r) => r.id), ...resting.map((r) => r.id)])];
}

/**
 * Set how deep The Mouse quotes on a wheel (a Cheesemonger decision). The current prices carry
 * over: from The Mouse's own quotes if it was already active, otherwise from `startPrices`
 * (outcome key -> probability 0..1, e.g. today's chances), falling back to an even split.
 */
export async function setWheelLiquidity(
  db: AnyDb,
  input: { wheelId: string; actorId: string; liquidity: number; startPrices?: Record<string, number> },
) {
  const liquidity = Math.trunc(Number(input.liquidity));
  if (!Number.isFinite(liquidity) || liquidity < 0 || liquidity > MAX_LIQUIDITY) {
    throw new ExchangeError("INVALID", `liquidity must be a whole number from 0 to ${MAX_LIQUIDITY.toLocaleString("en-US")}`);
  }
  const mouse = await ensureMouse(db);
  return runTx(db, async (tx) => {
    const [actor] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, input.actorId));
    if (!actor?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can set liquidity");
    const [w] = await tx.select().from(wheels).where(eq(wheels.id, input.wheelId)).for("update");
    if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
    if (w.status === "resolved" || w.status === "moldy") throw new ExchangeError("INVALID", "this wheel is already settled");
    const ws = await tx.select().from(wedges).where(eq(wedges.wheelId, w.id)).orderBy(asc(wedges.sortOrder), asc(wedges.createdAt));
    const ids = ws.map((x) => x.id);
    const pos = await tx.select().from(positions).where(and(eq(positions.userId, mouse.id), inArray(positions.wedgeId, ids)));
    const holdings = new Map<string, Holding>(pos.map((p) => [p.wedgeId, { yes: p.yesShares, no: p.noShares }]));
    const keys = outcomeKeys(ids);

    let mmAnchor: Record<string, number> | null = w.mmAnchor;
    if (liquidity > 0) {
      const current = mousePrices(w, ids, holdings);
      const even = ids.length === 1 ? 0.5 : 1 / ids.length;
      const probs = keys.map((k) => current?.get(k) ?? input.startPrices?.[k] ?? even);
      const a = anchorFor(probs, payoffs(ids, holdings), liquidity);
      mmAnchor = Object.fromEntries(keys.map((k, i) => [k, a[i]!]));
    }
    await tx.update(wheels).set({ liquidity, mmAnchor }).where(eq(wheels.id, w.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "wheel.liquidity",
      targetType: "wheel",
      targetId: w.id,
      details: { title: w.title, slug: w.slug, from: w.liquidity, to: liquidity },
    });
    return { liquidity };
  });
}
