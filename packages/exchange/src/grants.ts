/**
 * Super admins can reward people with Latta from the house. It is minted from grant_issuance
 * (negative, like the other issuance accounts) and every grant is a row in `grants`, so the audit
 * can check that the two always agree.
 */
import { accounts, eq, grants, users, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { Deltas, postEntry, userAccounts } from "./ledger";
import { logEvent } from "./log";
import { requireText } from "./review";

/** One grant can be at most this many ticks (100,000 Latta), a guard against typos. */
export const MAX_GRANT_TICKS = 100_000 * 100;

async function grantAccount(tx: Tx): Promise<string> {
  const find = () => tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "grant_issuance"));
  let [row] = await find();
  if (!row) {
    await tx.insert(accounts).values({ kind: "grant_issuance" }).onConflictDoNothing();
    [row] = await find();
  }
  return row!.id;
}

export async function grantLatta(db: AnyDb, input: { recipientId: string; actorId: string; ticks: number; reason: string }) {
  const reason = requireText(input.reason, "reason", 200);
  if (!Number.isSafeInteger(input.ticks) || input.ticks <= 0) throw new ExchangeError("INVALID", "enter an amount above 0");
  if (input.ticks > MAX_GRANT_TICKS) throw new ExchangeError("INVALID", "that's more than 100,000 Lc in one grant");
  return runTx(db, async (tx) => {
    const [actor] = await tx.select({ ok: users.isSuperAdmin }).from(users).where(eq(users.id, input.actorId));
    if (!actor?.ok) throw new ExchangeError("FORBIDDEN", "only super admins can do that");
    const [to] = await tx.select().from(users).where(eq(users.id, input.recipientId)).for("update");
    if (!to) throw new ExchangeError("NOT_FOUND", "user not found");
    if (to.isBot) throw new ExchangeError("INVALID", "you can't grant Latta to a bot");
    const [g] = await tx
      .insert(grants)
      .values({ recipientId: to.id, grantedById: input.actorId, ticks: input.ticks, reason })
      .returning({ id: grants.id });
    const issuance = await grantAccount(tx);
    const acc = await userAccounts(tx, to.id);
    await postEntry(
      tx,
      { kind: "grant", userId: to.id, memo: `grant: ${reason}`, idempotencyKey: `grant:${g!.id}` },
      new Deltas().add(issuance, -input.ticks).add(acc.available, input.ticks),
    );
    await logEvent(tx, {
      actorId: input.actorId,
      action: "grant.lc",
      targetType: "user",
      targetId: to.id,
      details: { name: to.name, ticks: input.ticks, reason },
    });
    return { grantId: g!.id };
  });
}
