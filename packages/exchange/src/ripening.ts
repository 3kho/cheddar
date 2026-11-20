/**
 * Ripening: resolving a Wheel.
 *
 *   1. The Wheel's creator (or a Cheesemonger) proposes a settlement with evidence.
 *      Trading on every Wedge halts immediately.
 *   2. A Cheesemonger approves it (payout) or rejects it (trading reopens).
 *
 * Payout, per Wedge, in one transaction with the Wedge rows locked:
 *   - cancel every open order and return its escrow,
 *   - pay each position out of the Wedge's collateral:
 *       winning wedge:  YES 100, NO 0
 *       losing wedge:   YES 0,   NO 100
 *       Moldy (void):   YES 50,  NO 50   (Polymarket-style 50-50)
 *       Date market:    per-wedge based on event_date comparison
 *   - collateral is exactly 100 per YES/NO pair, so every case empties it to 0.
 */
import { asc, eq, and, orders, positions, settlements, users, wedges, wheels, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { releaseOrder } from "./exchange";
import { Deltas, collateralAccount, lockedBalance, postEntry, userAccounts } from "./ledger";
import { logEvent } from "./log";
import { ensureMouse } from "./churn";
import { repayHouse } from "./house";
import { assertReviewer, requireText, type ReviewOptions } from "./review";

export type SettlementOutcome = "wedge_wins" | "all_no" | "all_yes" | "moldy" | "date" | "multi_yes";

export interface ProposeSettlementInput {
  wheelId: string;
  proposerId: string;
  outcome: SettlementOutcome;
  /** Required for wedge_wins (single winner). */
  winningWedgeId?: string;
  /** For multi-winner markets: array of winning wedge ids. Required for multi-yes/all_yes. */
  winningWedgeIds?: string[];
  /** For date markets: the event date. Wedges with date_value >= event_date resolve YES, others NO. */
  eventDate?: string;
  evidence: string;
}

export async function proposeSettlement(db: AnyDb, input: ProposeSettlementInput, opts: ReviewOptions = {}) {
  const evidence = requireText(input.evidence, "evidence", 5_000);
  return runTx(db, async (tx) => {
    const wheel = await lockWheel(tx, input.wheelId);
    if (wheel.status !== "open" && wheel.status !== "closed") {
      throw new ExchangeError("INVALID", `this wheel is already ${wheel.status}`);
    }
    const [u] = await tx
      .select({ isCheesemonger: users.isCheesemonger, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, input.proposerId));
    if (u?.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
    if (!u || (wheel.creatorId !== input.proposerId && !u.isCheesemonger)) {
      throw new ExchangeError("FORBIDDEN", "only the wheel's creator or a Cheesemonger can propose a settlement");
    }
    const ws = await lockWedges(tx, wheel.id);
    const wedgeIds = ws.map((w) => w.id);

    // Validate inputs based on outcome type
    if (input.outcome === "wedge_wins") {
      if (!input.winningWedgeId) throw new ExchangeError("INVALID", "wedge_wins requires a winning wedge");
      if (!ws.some((w) => w.id === input.winningWedgeId)) {
        throw new ExchangeError("INVALID", "the winning wedge must belong to this wheel");
      }
    } else if (input.winningWedgeId) {
      throw new ExchangeError("INVALID", "only wedge_wins names a single winning wedge");
    }

    if (input.outcome === "date") {
      if (!input.eventDate) throw new ExchangeError("INVALID", "date market settlement requires an event date");
      if (wheel.marketType !== "date") throw new ExchangeError("INVALID", "date settlement is only for date markets");
      // Validate all event dates exist
      if (ws.some((w) => !w.dateValue)) {
        throw new ExchangeError("INVALID", "all date outcomes must have a date_value set");
      }
    }

    if (input.outcome === "all_yes") {
      if (ws.length <= 1) throw new ExchangeError("INVALID", "all_yes requires multiple outcomes");
    }

    if (input.outcome === "date" && input.eventDate) {
      const eventDt = new Date(input.eventDate);
      const winningWedgeIds = ws
        .filter((w) => w.dateValue && new Date(w.dateValue) >= eventDt)
        .map((w) => w.id);
      input.winningWedgeIds = winningWedgeIds;
    }

    const [s] = await tx
      .insert(settlements)
      .values({
        wheelId: wheel.id,
        proposerId: input.proposerId,
        outcome: input.outcome,
        winningWedgeId: input.winningWedgeId ?? null,
        winningWedgeIds: input.winningWedgeIds ?? null,
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        evidence,
      })
      .returning();
    await tx.update(wheels).set({ status: "ripening" }).where(eq(wheels.id, wheel.id));
    await tx
      .update(wedges)
      .set({ status: "halted" })
      .where(and(eq(wedges.wheelId, wheel.id), eq(wedges.status, "open")));
    await logEvent(tx, {
      actorId: input.proposerId,
      action: "settlement.propose",
      targetType: "settlement",
      targetId: s!.id,
      details: {
        wheelId: wheel.id,
        title: wheel.title,
        slug: wheel.slug,
        outcome: input.outcome,
        winningWedgeId: input.winningWedgeId ?? null,
        winningWedgeIds: input.winningWedgeIds ?? null,
        eventDate: input.eventDate ?? null,
      },
    });
    return s!;
  });
}

export async function rejectSettlement(
  db: AnyDb,
  input: { settlementId: string; reviewerId: string; note?: string },
  opts: ReviewOptions = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  await runTx(db, async (tx) => {
    const s = await lockPendingSettlement(tx, input.settlementId);
    await assertReviewer(tx, input.reviewerId, s.proposerId, opts);
    const wheel = await lockWheel(tx, s.wheelId);
    await lockWedges(tx, wheel.id);
    await tx
      .update(settlements)
      .set({ status: "rejected", reviewerId: input.reviewerId, reviewNote: input.note ?? null, reviewedAt: now })
      .where(eq(settlements.id, s.id));
    await logEvent(tx, {
      actorId: input.reviewerId,
      action: "settlement.reject",
      targetType: "settlement",
      targetId: s.id,
      details: { wheelId: wheel.id, title: wheel.title, slug: wheel.slug, note: input.note ?? null },
    });
    await tx
      .update(wheels)
      .set({ status: wheel.closesAt && wheel.closesAt <= now ? "closed" : "open" })
      .where(eq(wheels.id, wheel.id));
    await tx
      .update(wedges)
      .set({ status: "open" })
      .where(and(eq(wedges.wheelId, wheel.id), eq(wedges.status, "halted")));
  });
}

export interface WedgePayout {
  wedgeId: string;
  result: "resolved_yes" | "resolved_no" | "moldy";
  cancelledOrders: number;
  paidTicks: number;
  holders: number;
}

export async function approveSettlement(
  db: AnyDb,
  input: {
    settlementId: string;
    reviewerId: string;
    /** Private note for the Cheesemongers' log. */
    note?: string;
    /** Public proof of the result, shown on the wheel. */
    proof?: string;
  },
  opts: ReviewOptions = {},
): Promise<WedgePayout[]> {
  const proof = input.proof?.trim() ? requireText(input.proof, "proof", 5_000) : null;
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    const s = await lockPendingSettlement(tx, input.settlementId);
    await assertReviewer(tx, input.reviewerId, s.proposerId, opts);
    const wheel = await lockWheel(tx, s.wheelId);
    if (wheel.status !== "ripening") throw new ExchangeError("INVALID", `this wheel is ${wheel.status}`);
    const ws = await lockWedges(tx, wheel.id);

    // Determine per-wedge results
    const winningWedgeIds = new Set(s.winningWedgeIds ?? []);
    const eventDate = s.eventDate ?? null;

    const report: WedgePayout[] = [];
    for (const w of ws) {
      let result: WedgePayout["result"];
      if (s.outcome === "moldy") {
        result = "moldy";
      } else if (s.outcome === "date") {
        // Date market: YES if date_value >= event_date, NO otherwise
        result = w.dateValue && eventDate && new Date(w.dateValue) >= eventDate ? "resolved_yes" : "resolved_no";
      } else if (s.outcome === "wedge_wins") {
        result = w.id === s.winningWedgeId ? "resolved_yes" : "resolved_no";
      } else if (s.outcome === "all_yes") {
        result = "resolved_yes";
      } else if (s.outcome === "all_no") {
        result = "resolved_no";
      } else if (s.outcome === "multi_yes") {
        result = winningWedgeIds.has(w.id) ? "resolved_yes" : "resolved_no";
      } else {
        throw new ExchangeError("INVALID", `unknown settlement outcome ${s.outcome}`);
      }

      const [yesPay, noPay] = result === "moldy" ? [50, 50] : result === "resolved_yes" ? [100, 0] : [0, 100];

      // 1. Cancel open orders so every escrowed Latta and share is back with its owner.
      const open = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.wedgeId, w.id), eq(orders.status, "open")))
        .orderBy(asc(orders.seq))
        .for("update");
      for (const o of open) await releaseOrder(tx, o, "wheel_settled", now);

      // 2. Pay every position from collateral.
      const held = await tx.select().from(positions).where(eq(positions.wedgeId, w.id));
      const deltas = new Deltas();
      let total = 0;
      let holders = 0;
      for (const p of held) {
        const amount = p.yesShares * yesPay + p.noShares * noPay;
        if (amount === 0) continue;
        const a = await userAccounts(tx, p.userId);
        deltas.add(a.available, amount);
        total += amount;
        holders++;
      }
      const collateral = await collateralAccount(tx, w.id);
      const backing = await lockedBalance(tx, collateral);
      if (backing !== total) {
        throw new Error(`wedge ${w.id}: collateral ${backing} does not match payout ${total}; refusing to settle`);
      }
      deltas.add(collateral, -total);
      await postEntry(
        tx,
        {
          kind: result === "moldy" ? "moldy_refund" : "payout",
          wedgeId: w.id,
          idempotencyKey: `payout:${w.id}`,
          memo: `settlement ${s.id}: ${result}`,
        },
        deltas,
      );
      await tx
        .update(wedges)
        .set({ status: result, bookVersion: w.bookVersion + 1 })
        .where(eq(wedges.id, w.id));
      report.push({ wedgeId: w.id, result, cancelledOrders: open.length, paidTicks: total, holders });
    }

    await tx
      .update(wheels)
      .set({ status: s.outcome === "moldy" ? "moldy" : "resolved", resolvedAt: now })
      .where(eq(wheels.id, wheel.id));
    // The Mouse was just paid for its positions here: hand back any house Latta it can.
    await repayHouse(tx, (await ensureMouse(tx)).id);
    await tx
      .update(settlements)
      .set({ status: "approved", reviewerId: input.reviewerId, reviewNote: input.note ?? null, proof, reviewedAt: now })
      .where(eq(settlements.id, s.id));
    await logEvent(tx, {
      actorId: input.reviewerId,
      action: "settlement.approve",
      targetType: "settlement",
      targetId: s.id,
      details: {
        wheelId: wheel.id,
        title: wheel.title,
        slug: wheel.slug,
        outcome: s.outcome,
        paidTicks: report.reduce((n, r) => n + r.paidTicks, 0),
        note: input.note ?? null,
      },
    });
    return report;
  });
}

async function lockWheel(tx: Tx, wheelId: string) {
  const [w] = await tx.select().from(wheels).where(eq(wheels.id, wheelId)).for("update");
  if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
  return w;
}

/** Lock in id order so concurrent settlements and trades can't deadlock on each other's wedges. */
async function lockWedges(tx: Tx, wheelId: string) {
  return tx.select().from(wedges).where(eq(wedges.wheelId, wheelId)).orderBy(asc(wedges.id)).for("update");
}

async function lockPendingSettlement(tx: Tx, settlementId: string) {
  const [s] = await tx.select().from(settlements).where(eq(settlements.id, settlementId)).for("update");
  if (!s) throw new ExchangeError("NOT_FOUND", "settlement not found");
  if (s.status !== "pending") throw new ExchangeError("INVALID", `settlement is already ${s.status}`);
  return s;
}
