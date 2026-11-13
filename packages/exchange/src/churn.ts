/**
 * Churn: Hackatime non-AI coding hours -> Latta.
 *
 * Rule: a user has earned floor(lifetimeNonAiSeconds * 25 Latta / 3600) in total
 * (2,500 ticks per hour). Each sync credits target - alreadyCredited, so syncs are
 * idempotent and retries can't double-pay. "Already credited" is read from the
 * ledger itself, not from a counter.
 *
 *   - Red trust (banned on Hackatime): nothing is credited. Hours keep counting, so
 *     the full backlog arrives on the first sync after the ban is lifted.
 *   - Hours going down (e.g. fraud squad removed some): nothing is clawed back.
 *   - Mouse funders (HC staff / adults): their Churn goes to The Mouse. The journal
 *     entry still records whose hours earned it.
 */
import {
  and,
  eq,
  inArray,
  sql,
  churnSyncs,
  mouseFunders,
  orders,
  positions,
  users,
  wedges,
  type AnyDb,
  type Tx,
} from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { cancelUserOrders } from "./exchange";
import { logEvent } from "./log";
import type { HackatimeClient, TrustLevel } from "./hackatime";
import { Deltas, adjustPosition, churnIssuanceAccount, lockedBalance, postEntry, userAccounts } from "./ledger";

export const LATTA_PER_HOUR = 25;
export const TICKS_PER_LATTA = 100;

/** floor(seconds * 2500 / 3600) in exact integer arithmetic. */
export function ticksForSeconds(seconds: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error(`bad seconds ${seconds}`);
  return Math.floor((seconds * LATTA_PER_HOUR * TICKS_PER_LATTA) / 3600);
}

export type ChurnStatus = "credited" | "no_change" | "skipped_untrusted" | "error";

export interface ChurnResult {
  userId: string;
  status: ChurnStatus;
  creditedTicks: number;
  targetTicks?: number;
  toMouse?: boolean;
  error?: string;
}

export interface ChurnOptions {
  /** Hackatime OAuth token for users whose stats are private. */
  tokenFor?: (userId: string) => Promise<string | undefined>;
}

/** The Mouse bot user, created on first use. */
export async function ensureMouse(db: AnyDb | Tx): Promise<{ id: string }> {
  const find = () => db.select({ id: users.id }).from(users).where(eq(users.botRole, "mouse"));
  let [m] = await find();
  if (!m) {
    await db.insert(users).values({ name: "The Mouse", isBot: true, botRole: "mouse" }).onConflictDoNothing();
    [m] = await find();
  }
  return m!;
}

/** Ticks already credited for this user's hours (to them or to The Mouse). */
async function creditedSoFar(tx: Tx, userId: string): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT COALESCE(-SUM(l.amount), 0)::text AS credited
    FROM ledger_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE e.kind = 'churn' AND e.user_id = ${userId} AND a.kind = 'churn_issuance'
  `)) as unknown as { rows: { credited: string }[] };
  return Number(r.rows[0]!.credited);
}

export async function syncUser(db: AnyDb, client: HackatimeClient, userId: string, opts: ChurnOptions = {}): Promise<ChurnResult> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new ExchangeError("NOT_FOUND", "user not found");
  if (u.isBot) throw new ExchangeError("INVALID", "bots don't churn");
  // Mouse funders don't need to link: Hackatime looks them up by Slack id.
  if (!u.hackatimeUserId && !(await isActiveFunder(db, u.slackId))) {
    throw new ExchangeError("INVALID", "user has no linked Hackatime account");
  }

  let snap: { lifetimeNonAiSeconds: number; trustLevel: TrustLevel };
  try {
    snap = await client.snapshot({
      hackatimeUserId: u.hackatimeUserId,
      slackId: u.slackId,
      bearerToken: await opts.tokenFor?.(userId),
    });
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    await db.insert(churnSyncs).values({ userId, status: "error", error });
    return { userId, status: "error", creditedTicks: 0, error };
  }

  return runTx(db, async (tx) => {
    // One sync per user at a time; also orders this against a concurrent funder sweep.
    const [locked] = await tx.select({ slackId: users.slackId }).from(users).where(eq(users.id, userId)).for("update");
    const targetTicks = ticksForSeconds(snap.lifetimeNonAiSeconds);
    const base = { userId, lifetimeNonAiSeconds: snap.lifetimeNonAiSeconds, trustLevel: snap.trustLevel, targetTicks };

    if (snap.trustLevel === "red") {
      await tx.insert(churnSyncs).values({ ...base, status: "skipped_untrusted" });
      return { userId, status: "skipped_untrusted" as const, creditedTicks: 0, targetTicks };
    }
    const delta = targetTicks - (await creditedSoFar(tx, userId));
    if (delta <= 0) {
      await tx.insert(churnSyncs).values({ ...base, status: "no_change" });
      return { userId, status: "no_change" as const, creditedTicks: 0, targetTicks };
    }

    const toMouse = await isActiveFunder(tx, locked?.slackId ?? null);
    const recipient = toMouse ? (await ensureMouse(tx)).id : userId;
    const dest = await userAccounts(tx, recipient);
    const issuance = await churnIssuanceAccount(tx);
    const entryId = await postEntry(
      tx,
      {
        kind: "churn",
        userId,
        idempotencyKey: `churn:${userId}:${targetTicks}`,
        memo: toMouse ? "fed the mouse" : undefined,
      },
      new Deltas().add(issuance, -delta).add(dest.available, delta),
    );
    await tx.insert(churnSyncs).values({ ...base, status: "credited", creditedTicks: delta, journalEntryId: entryId });
    return { userId, status: "credited" as const, creditedTicks: delta, targetTicks, toMouse };
  });
}

/** Sync every linked human, plus every active Mouse funder (by Slack id). Failures never stop the run. */
export async function syncAll(db: AnyDb, client: HackatimeClient, opts: ChurnOptions & { concurrency?: number } = {}) {
  const linked = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isBot, false),
        sql`(${users.hackatimeUserId} IS NOT NULL OR EXISTS (
          SELECT 1 FROM mouse_funders f WHERE f.slack_id = ${users.slackId} AND f.active))`,
      ),
    );
  const results: ChurnResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < linked.length) {
      const id = linked[next++]!.id;
      try {
        results.push(await syncUser(db, client, id, opts));
      } catch (e) {
        results.push({ userId: id, status: "error", creditedTicks: 0, error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return results;
}

// ---------- Mouse funders ----------

async function isActiveFunder(tx: AnyDb | Tx, slackId: string | null): Promise<boolean> {
  if (!slackId) return false;
  const [f] = await tx
    .select({ slackId: mouseFunders.slackId })
    .from(mouseFunders)
    .where(and(eq(mouseFunders.slackId, slackId), eq(mouseFunders.active, true)));
  return !!f;
}

async function assertCheesemonger(tx: Tx, userId: string) {
  const [u] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, userId));
  if (!u?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can manage Mouse funders");
}

export interface SweepResult {
  cancelledOrders: number;
  movedPositions: number;
  sweptTicks: number;
}

/**
 * Make a Slack user a Mouse funder.
 *  - Already on Cheddar: their open orders are cancelled and all their Latta and unsettled
 *    shares move to The Mouse.
 *  - Never signed up: a placeholder account is created for their Slack id so Churn can pull
 *    their Hackatime hours into The Mouse right away. If they log in later, they claim it.
 */
export async function addMouseFunder(
  db: AnyDb,
  input: { slackId: string; addedById: string; note?: string },
  opts: { now?: () => Date } = {},
): Promise<{ userId: string; created: boolean; swept: SweepResult | null }> {
  const slackId = input.slackId.trim().toUpperCase();
  if (!/^[UW][A-Z0-9]{5,}$/.test(slackId)) throw new ExchangeError("INVALID", "that doesn't look like a Slack user id");
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.addedById);
    await tx
      .insert(mouseFunders)
      .values({ slackId, addedById: input.addedById, note: input.note ?? null })
      .onConflictDoUpdate({ target: mouseFunders.slackId, set: { active: true, note: input.note ?? null } });
    const [existing] = await tx.select({ id: users.id, isBot: users.isBot }).from(users).where(eq(users.slackId, slackId)).for("update");
    if (existing?.isBot) throw new ExchangeError("INVALID", "that Slack id belongs to a bot");
    let userId = existing?.id;
    if (!userId) {
      const [created] = await tx.insert(users).values({ slackId }).returning({ id: users.id });
      userId = created!.id;
    }
    const swept = existing ? await sweepToMouse(tx, userId, now) : null;
    await logEvent(tx, {
      actorId: input.addedById,
      action: "funder.add",
      targetType: "funder",
      targetId: slackId,
      details: { note: input.note ?? null, userId, placeholder: !existing, ...(swept ?? {}) },
    });
    return { userId, created: !existing, swept };
  });
}

/** Stop routing a funder's future Churn to The Mouse. What was already sent stays there. */
export async function removeMouseFunder(db: AnyDb, input: { slackId: string; removedById: string }) {
  await runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.removedById);
    await tx
      .update(mouseFunders)
      .set({ active: false })
      .where(eq(mouseFunders.slackId, input.slackId.trim().toUpperCase()));
    await logEvent(tx, {
      actorId: input.removedById,
      action: "funder.remove",
      targetType: "funder",
      targetId: input.slackId.trim().toUpperCase(),
    });
  });
}

/** Caller must hold the user's row lock (FOR UPDATE), which blocks their new orders. */
async function sweepToMouse(tx: Tx, userId: string, now: Date): Promise<SweepResult> {
  const mouse = await ensureMouse(tx);
  const { cancelled: cancelledOrders, wedgeIds } = await cancelUserOrders(tx, userId, "mouse_funder", now, {
    alsoPositions: true,
  });
  let movedPositions = 0;
  if (wedgeIds.length) {
    const held = await tx
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), inArray(positions.wedgeId, wedgeIds)));
    for (const p of held) {
      if (p.yesShares === 0 && p.noShares === 0) continue;
      await adjustPosition(tx, userId, p.wedgeId, { yesShares: -p.yesShares, noShares: -p.noShares });
      await adjustPosition(tx, mouse.id, p.wedgeId, { yesShares: p.yesShares, noShares: p.noShares });
      movedPositions++;
    }
  }

  const from = await userAccounts(tx, userId);
  const to = await userAccounts(tx, mouse.id);
  const stillLocked = await lockedBalance(tx, from.locked);
  if (stillLocked !== 0) throw new Error(`funder ${userId} still has ${stillLocked} locked after cancelling orders`);
  const sweptTicks = await lockedBalance(tx, from.available);
  await postEntry(
    tx,
    { kind: "mouse_sweep", userId, memo: "funder balance moved to The Mouse" },
    new Deltas().add(from.available, -sweptTicks).add(to.available, sweptTicks),
  );
  return { cancelledOrders, movedPositions, sweptTicks };
}
