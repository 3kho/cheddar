/**
 * House backing for The Mouse. The Mouse quotes with its own (funded) cash first; only when that
 * runs out does the house lend it Latta, minted from the house_issuance account. Whenever The
 * Mouse has spare cash again it pays the house back first, so house Latta only exists while it's
 * actually backing quotes or positions.
 */
import { accounts, eq, type Tx } from "@cheddar/db";
import { Deltas, lockedBalance, postEntry, userAccounts } from "./ledger";

export async function houseAccount(tx: Tx): Promise<string> {
  const find = () => tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "house_issuance"));
  let [row] = await find();
  if (!row) {
    await tx.insert(accounts).values({ kind: "house_issuance" }).onConflictDoNothing();
    [row] = await find();
  }
  return row!.id;
}

/** Make sure `userId` has at least `need` ticks available, borrowing the shortfall from the house. */
export async function ensureCash(tx: Tx, userId: string, need: number): Promise<number> {
  if (need <= 0) return 0;
  const a = await userAccounts(tx, userId);
  const have = await lockedBalance(tx, a.available);
  if (have >= need) return 0;
  const short = need - have;
  const house = await houseAccount(tx);
  await postEntry(
    tx,
    { kind: "house_backing", userId, memo: "house-backed liquidity" },
    new Deltas().add(house, -short).add(a.available, short),
  );
  return short;
}

/** Pay back as much house Latta as `userId`'s spare cash allows. Returns ticks repaid. */
export async function repayHouse(tx: Tx, userId: string): Promise<number> {
  const house = await houseAccount(tx);
  const owed = -(await lockedBalance(tx, house));
  if (owed <= 0) return 0;
  const a = await userAccounts(tx, userId);
  const have = await lockedBalance(tx, a.available);
  const pay = Math.min(owed, have);
  if (pay <= 0) return 0;
  await postEntry(tx, { kind: "house_repay", userId, memo: "repaid house backing" }, new Deltas().add(a.available, -pay).add(house, pay));
  return pay;
}

/** House Latta currently lent out (ticks). */
export async function houseOutstanding(tx: Tx): Promise<number> {
  const [row] = await tx.select({ b: accounts.balance }).from(accounts).where(eq(accounts.kind, "house_issuance"));
  return row ? Math.max(0, -row.b) : 0;
}
