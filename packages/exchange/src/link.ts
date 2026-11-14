/**
 * Linked outcomes. In a multi-outcome wheel exactly one wedge wins, so some bundles of shares are
 * worth a fixed amount no matter what happens. These conversions let people cash them in or
 * reshape them straight away, instead of waiting for the settlement:
 *
 *   mergePairs    k YES + k NO on one wedge          -> k Latta (any wheel)
 *   mergeYesSet   k YES on every wedge               -> k Latta (exactly one pays)
 *   convertNo     k NO on each of m chosen wedges    -> k YES on every other wedge
 *                                                       + (m - 1) * k Latta
 *                 (choosing every wedge cashes a full NO set in for (n - 1) * k Latta)
 *
 * The Mouse is the counterparty for the multi-wedge ones and only ever ends up holding riskless
 * bundles (YES on every wedge, or NO on every wedge), which pay back exactly what it spent when
 * the wheel ripens. Bundles add the same amount to every outcome of its LMSR, so prices don't move.
 * (A Moldy void pays every share 50, so on a 3+ outcome wheel a NO bundle returns less than it
 * cost; that small loss is The Mouse's.)
 */
import { and, asc, eq, positions, wedges, wheels, type AnyDb, type Tx } from "@cheddar/db";
import { ensureMouse } from "./churn";
import { ExchangeError, runTx } from "./errors";
import { assertCanTrade } from "./exchange";
import { ensureCash } from "./house";
import { Deltas, adjustPosition, collateralAccount, postEntry, userAccounts } from "./ledger";

export interface ConversionResult {
  /** Latta paid to the user (ticks). */
  paidTicks: number;
  shares: number;
}

function whole(shares: number) {
  const k = Math.trunc(Number(shares));
  if (!Number.isFinite(k) || k <= 0 || k > 1_000_000) throw new ExchangeError("INVALID", "enter a whole number of shares");
  return k;
}

/** Lock a wheel's wedges in id order (the same order trading and settlement use). */
async function lockTradableWheel(tx: Tx, wheelId: string) {
  const [w] = await tx.select().from(wheels).where(eq(wheels.id, wheelId));
  if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
  const ws = await tx.select().from(wedges).where(eq(wedges.wheelId, wheelId)).orderBy(asc(wedges.id)).for("update");
  if (w.status !== "open" || ws.some((x) => x.status !== "open")) {
    throw new ExchangeError("MARKET_CLOSED", "this wheel isn't open, so its shares can't be converted right now");
  }
  return { wheel: w, wedges: ws };
}

/**
 * Full-set conversions assume the list of outcomes is final. On a wheel that can still gain
 * outcomes, a "Yes on every outcome" set could lose if a new one is added and wins.
 */
function assertFixedOutcomes(wheel: { allowAdditions: boolean }) {
  if (wheel.allowAdditions) {
    throw new ExchangeError("INVALID", "new outcomes can still be added to this wheel, so whole-wheel conversions are off");
  }
}

async function freeShares(tx: Tx, userId: string, wedgeId: string) {
  const [p] = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.wedgeId, wedgeId)))
    .for("update");
  return { yes: p ? p.yesShares - p.yesLocked : 0, no: p ? p.noShares - p.noLocked : 0 };
}

/** k YES + k NO on one wedge -> k Latta, straight from the wedge's collateral. */
export async function mergePairs(db: AnyDb, input: { userId: string; wedgeId: string; shares: number }): Promise<ConversionResult> {
  const k = whole(input.shares);
  return runTx(db, async (tx) => {
    const [wedge] = await tx.select({ wheelId: wedges.wheelId }).from(wedges).where(eq(wedges.id, input.wedgeId));
    if (!wedge) throw new ExchangeError("NOT_FOUND", "wedge not found");
    await lockTradableWheel(tx, wedge.wheelId);
    await assertCanTrade(tx, input.userId);
    const f = await freeShares(tx, input.userId, input.wedgeId);
    if (f.yes < k || f.no < k) throw new ExchangeError("INSUFFICIENT_SHARES", "you need that many Yes and No shares (not reserved by orders)");
    const a = await userAccounts(tx, input.userId);
    await adjustPosition(tx, input.userId, input.wedgeId, { yesShares: -k, noShares: -k });
    await postEntry(
      tx,
      { kind: "conversion", userId: input.userId, wedgeId: input.wedgeId, memo: "merged yes/no pairs" },
      new Deltas().add(await collateralAccount(tx, input.wedgeId), -100 * k).add(a.available, 100 * k),
    );
    return { paidTicks: 100 * k, shares: k };
  });
}

/** k YES on every wedge of a multi-outcome wheel -> k Latta. The Mouse takes the set. */
export async function mergeYesSet(db: AnyDb, input: { userId: string; wheelId: string; shares: number }): Promise<ConversionResult> {
  const k = whole(input.shares);
  const mouse = await ensureMouse(db);
  return runTx(db, async (tx) => {
    const { wheel, wedges: ws } = await lockTradableWheel(tx, input.wheelId);
    assertFixedOutcomes(wheel);
    if (ws.length < 2) throw new ExchangeError("INVALID", "only multi-outcome wheels have full sets");
    await assertCanTrade(tx, input.userId);
    if (input.userId === mouse.id) throw new ExchangeError("INVALID", "The Mouse can't convert with itself");
    for (const w of ws) {
      if ((await freeShares(tx, input.userId, w.id)).yes < k) {
        throw new ExchangeError("INSUFFICIENT_SHARES", "you need that many Yes shares on every outcome (not reserved by orders)");
      }
    }
    for (const w of ws) {
      await adjustPosition(tx, input.userId, w.id, { yesShares: -k });
      await adjustPosition(tx, mouse.id, w.id, { yesShares: k });
    }
    await ensureCash(tx, mouse.id, 100 * k);
    const [ua, ma] = [await userAccounts(tx, input.userId), await userAccounts(tx, mouse.id)];
    await postEntry(
      tx,
      { kind: "conversion", userId: input.userId, memo: "merged a full yes set" },
      new Deltas().add(ma.available, -100 * k).add(ua.available, 100 * k),
    );
    return { paidTicks: 100 * k, shares: k };
  });
}

/**
 * k NO on each chosen wedge -> k YES on every other wedge, plus (m - 1) * k Latta.
 * The Mouse takes the NO shares and mints YES/NO pairs on the other wedges (keeping their NO).
 */
export async function convertNo(
  db: AnyDb,
  input: { userId: string; wheelId: string; wedgeIds: string[]; shares: number },
): Promise<ConversionResult & { yesOn: string[] }> {
  const k = whole(input.shares);
  const chosen = [...new Set(input.wedgeIds)];
  if (!chosen.length) throw new ExchangeError("INVALID", "pick at least one outcome");
  const mouse = await ensureMouse(db);
  return runTx(db, async (tx) => {
    const { wheel, wedges: ws } = await lockTradableWheel(tx, input.wheelId);
    assertFixedOutcomes(wheel);
    if (ws.length < 2) throw new ExchangeError("INVALID", "only multi-outcome wheels can convert No shares");
    if (chosen.some((id) => !ws.some((w) => w.id === id))) throw new ExchangeError("INVALID", "those outcomes aren't on this wheel");
    await assertCanTrade(tx, input.userId);
    if (input.userId === mouse.id) throw new ExchangeError("INVALID", "The Mouse can't convert with itself");
    for (const id of chosen) {
      if ((await freeShares(tx, input.userId, id)).no < k) {
        throw new ExchangeError("INSUFFICIENT_SHARES", "you need that many No shares on each chosen outcome (not reserved by orders)");
      }
    }
    const rest = ws.filter((w) => !chosen.includes(w.id));
    const paid = 100 * k * (chosen.length - 1);
    const minted = 100 * k * rest.length;
    await ensureCash(tx, mouse.id, paid + minted);

    for (const id of chosen) {
      await adjustPosition(tx, input.userId, id, { noShares: -k });
      await adjustPosition(tx, mouse.id, id, { noShares: k });
    }
    const [ua, ma] = [await userAccounts(tx, input.userId), await userAccounts(tx, mouse.id)];
    const d = new Deltas().add(ma.available, -(paid + minted));
    if (paid) d.add(ua.available, paid);
    for (const w of rest) {
      await adjustPosition(tx, input.userId, w.id, { yesShares: k });
      await adjustPosition(tx, mouse.id, w.id, { noShares: k });
      d.add(await collateralAccount(tx, w.id), 100 * k);
    }
    await postEntry(tx, { kind: "conversion", userId: input.userId, memo: `converted no on ${chosen.length} outcome(s)` }, d);
    return { paidTicks: paid, shares: k, yesOn: rest.map((w) => w.id) };
  });
}
