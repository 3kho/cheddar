import { and, eq } from "@cheddar/db";
import { accounts, churnSyncs, positions, users, wedges, wheels, type AnyDb } from "@cheddar/db";
import { ledger } from "../src/index";

let counter = 0;

export async function makeUser(db: AnyDb, name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ hcaSub: `ident!${name}-${++counter}`, name, ...extra })
    .returning();
  return u!;
}

/** Credit Latta the way Churn will: from the issuance account. */
export async function fund(db: AnyDb, userId: string, ticks: number) {
  await db.transaction(async (tx) => {
    const a = await ledger.userAccounts(tx, userId);
    const issuance = await ledger.churnIssuanceAccount(tx);
    const entryId = await ledger.postEntry(
      tx,
      { kind: "churn", userId },
      new ledger.Deltas().add(issuance, -ticks).add(a.available, ticks),
    );
    await tx.insert(churnSyncs).values({ userId, status: "credited", creditedTicks: ticks, journalEntryId: entryId });
  });
}

export async function makeWheel(db: AnyDb, creatorId: string, labels: string[], closesAt = new Date("2099-01-01")) {
  const [wheel] = await db
    .insert(wheels)
    .values({
      slug: `wheel-${++counter}`,
      title: "Test wheel",
      resolutionCriteria: "Test",
      closesAt,
      creatorId,
    })
    .returning();
  const ws = await db
    .insert(wedges)
    .values(labels.map((label, i) => ({ wheelId: wheel!.id, label, sortOrder: i })))
    .returning();
  return { wheel: wheel!, wedges: ws };
}

export async function balances(db: AnyDb, userId: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.userId, userId));
  return {
    available: rows.find((r) => r.kind === "user_available")?.balance ?? 0,
    locked: rows.find((r) => r.kind === "user_locked")?.balance ?? 0,
  };
}

export async function position(db: AnyDb, userId: string, wedgeId: string) {
  const [p] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.wedgeId, wedgeId)));
  return p ?? { yesShares: 0, noShares: 0, yesLocked: 0, noLocked: 0 };
}

export async function collateral(db: AnyDb, wedgeId: string) {
  const [a] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.kind, "wedge_collateral"), eq(accounts.wedgeId, wedgeId)));
  return a?.balance ?? 0;
}

/** Deterministic PRNG for fuzz tests. */
export function rng(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
