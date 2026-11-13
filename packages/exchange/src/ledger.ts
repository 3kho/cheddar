import { and, eq, sql } from "@cheddar/db";
import { accounts, journalEntries, ledgerLines, positions, type Tx } from "@cheddar/db";

type JournalKind = (typeof journalEntries.$inferInsert)["kind"];

export interface UserAccounts {
  available: string;
  locked: string;
}

/** The user's available + locked account ids, creating them on first use. */
export async function userAccounts(tx: Tx, userId: string): Promise<UserAccounts> {
  let rows = await tx
    .select({ id: accounts.id, kind: accounts.kind })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  if (rows.length < 2) {
    await tx
      .insert(accounts)
      .values([
        { kind: "user_available", userId },
        { kind: "user_locked", userId },
      ])
      .onConflictDoNothing();
    rows = await tx.select({ id: accounts.id, kind: accounts.kind }).from(accounts).where(eq(accounts.userId, userId));
  }
  const available = rows.find((r) => r.kind === "user_available")?.id;
  const locked = rows.find((r) => r.kind === "user_locked")?.id;
  if (!available || !locked) throw new Error(`accounts missing for user ${userId}`);
  return { available, locked };
}

export async function collateralAccount(tx: Tx, wedgeId: string): Promise<string> {
  const find = () =>
    tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.kind, "wedge_collateral"), eq(accounts.wedgeId, wedgeId)));
  let [row] = await find();
  if (!row) {
    await tx.insert(accounts).values({ kind: "wedge_collateral", wedgeId }).onConflictDoNothing();
    [row] = await find();
  }
  return row!.id;
}

export async function churnIssuanceAccount(tx: Tx): Promise<string> {
  const [row] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "churn_issuance"));
  if (!row) throw new Error("churn issuance account missing (migrations not applied?)");
  return row.id;
}

/** Locks the account row and returns its balance. */
export async function lockedBalance(tx: Tx, accountId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .for("update");
  return row!.balance;
}

/** Accumulates signed per-account deltas for one journal entry. */
export class Deltas {
  private m = new Map<string, number>();
  add(accountId: string, amount: number): this {
    if (!Number.isSafeInteger(amount)) throw new Error(`non-integer ledger amount ${amount}`);
    this.m.set(accountId, (this.m.get(accountId) ?? 0) + amount);
    return this;
  }
  lines(): { accountId: string; amount: number }[] {
    return [...this.m].filter(([, a]) => a !== 0).map(([accountId, amount]) => ({ accountId, amount }));
  }
}

/**
 * Writes one balanced journal entry. Returns its id, or null if every delta was 0.
 * Balance is checked here and again by the database at commit.
 */
export async function postEntry(
  tx: Tx,
  meta: {
    kind: JournalKind;
    userId?: string;
    wedgeId?: string;
    orderId?: string;
    memo?: string;
    idempotencyKey?: string;
  },
  deltas: Deltas,
): Promise<number | null> {
  const lines = deltas.lines();
  if (lines.length === 0) return null;
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (sum !== 0) throw new Error(`unbalanced ${meta.kind} entry (sum ${sum})`);
  const [entry] = await tx.insert(journalEntries).values(meta).returning({ id: journalEntries.id });
  await tx.insert(ledgerLines).values(lines.map((l) => ({ entryId: entry!.id, ...l })));
  return entry!.id;
}

export interface PositionDelta {
  yesShares?: number;
  noShares?: number;
  yesLocked?: number;
  noLocked?: number;
}

/**
 * Adds signed deltas to a user's position (creating it at zero). DB checks reject negatives.
 * Callers must hold the wedge's row lock, which is what makes update-then-insert race-free.
 * (Not an upsert: Postgres checks constraints on the proposed insert row before ON CONFLICT,
 * so a lock-only delta would be rejected even when the existing row is valid.)
 */
export async function adjustPosition(tx: Tx, userId: string, wedgeId: string, d: PositionDelta): Promise<void> {
  const v = { yesShares: d.yesShares ?? 0, noShares: d.noShares ?? 0, yesLocked: d.yesLocked ?? 0, noLocked: d.noLocked ?? 0 };
  if (!v.yesShares && !v.noShares && !v.yesLocked && !v.noLocked) return;
  const updated = await tx
    .update(positions)
    .set({
      yesShares: sql`${positions.yesShares} + ${v.yesShares}`,
      noShares: sql`${positions.noShares} + ${v.noShares}`,
      yesLocked: sql`${positions.yesLocked} + ${v.yesLocked}`,
      noLocked: sql`${positions.noLocked} + ${v.noLocked}`,
    })
    .where(and(eq(positions.userId, userId), eq(positions.wedgeId, wedgeId)))
    .returning({ userId: positions.userId });
  if (updated.length === 0) await tx.insert(positions).values({ userId, wedgeId, ...v });
}

export function sharesDelta(outcome: "YES" | "NO", shares: number, locked: number): PositionDelta {
  return outcome === "YES" ? { yesShares: shares, yesLocked: locked } : { noShares: shares, noLocked: locked };
}
