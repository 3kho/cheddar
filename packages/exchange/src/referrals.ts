/**
 * Referrals. Someone shares their invite link (/r/<code>); a brand-new person who signs up through
 * it is recorded as invited. When that person makes their first real trade, both of them get a
 * reward, minted from referral_issuance so the books still balance (see audit).
 *
 * Rules, all in one place so they can be tuned:
 *  - the invited person must be a brand-new account (made within a day of signing in via the link);
 *  - the reward is paid on their first real trade, once their total traded value reaches a minimum
 *    (so a one-cent poke doesn't count), and never twice;
 *  - the inviter earns on at most `cap` invited people; past that, the invited person still gets
 *    their welcome bonus but the inviter doesn't;
 *  - suspended accounts and bots never earn, and nobody can invite themselves.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, referrals, sql, tradeLegs, users, accounts, type AnyDb, type Tx } from "@cheddar/db";
import { TICKS_PER_LATTA } from "./churn";
import { runTx } from "./errors";
import { Deltas, postEntry, userAccounts } from "./ledger";
import { logEvent } from "./log";

export interface ReferralConfig {
  /** Paid to the person who invited (ticks). */
  referrerTicks: number;
  /** Paid to the person who was invited (ticks). */
  refereeTicks: number;
  /** Most invited people one person can earn a reward on. */
  cap: number;
  /** Total traded value (ticks) the invited person needs before the reward pays. */
  minVolumeTicks: number;
}

export const DEFAULT_REFERRAL: ReferralConfig = {
  referrerTicks: 20 * TICKS_PER_LATTA,
  refereeTicks: 10 * TICKS_PER_LATTA,
  cap: 10,
  minVolumeTicks: 5 * TICKS_PER_LATTA,
};

/** An invited account has to have been created within this long of signing in through the link. */
const NEW_ACCOUNT_WINDOW_MS = 24 * 3600 * 1000;

const CODE_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789"; // no 0/o/1/l/i lookalikes
const CODE_LENGTH = 8;

function newCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export const isReferralCode = (s: string) => /^[a-z0-9]{6,16}$/.test(s);

const isUniqueViolation = (e: unknown) => {
  for (let cur: unknown = e; cur && typeof cur === "object"; cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
};

async function referralAccount(tx: Tx): Promise<string> {
  const find = () => tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "referral_issuance"));
  let [row] = await find();
  if (!row) {
    await tx.insert(accounts).values({ kind: "referral_issuance" }).onConflictDoNothing();
    [row] = await find();
  }
  return row!.id;
}

/** The person's invite code, creating it the first time. */
export async function ensureReferralCode(db: AnyDb, userId: string): Promise<string> {
  const [u] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
  if (u?.code) return u.code;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const code = newCode();
      const [set] = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), sql`${users.referralCode} IS NULL`))
        .returning({ code: users.referralCode });
      if (set) return set.code!;
      // Someone else (a parallel request) set it first.
      const [again] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
      if (again?.code) return again.code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // code clash: try another
    }
  }
  throw new Error("could not create a referral code");
}

/**
 * Record that `refereeId` was invited by the owner of `code`. Quietly does nothing when the link
 * doesn't apply (unknown code, not a new account, already invited, self-invite...), so a bad link
 * can never break signing in.
 */
export async function attachReferral(
  db: AnyDb,
  input: { refereeId: string; code: string },
  opts: { now?: () => Date } = {},
): Promise<{ referrerId: string } | null> {
  const code = input.code.trim().toLowerCase();
  if (!isReferralCode(code)) return null;
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    const [me] = await tx.select().from(users).where(eq(users.id, input.refereeId)).for("update");
    if (!me || me.isBot || me.referredById) return null;
    if (now.getTime() - me.createdAt.getTime() > NEW_ACCOUNT_WINDOW_MS) return null;
    const [inviter] = await tx.select().from(users).where(eq(users.referralCode, code));
    if (!inviter || inviter.id === me.id || inviter.isBot || inviter.suspendedAt) return null;
    const [existing] = await tx.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeId, me.id));
    if (existing) return null;
    await tx.insert(referrals).values({ referrerId: inviter.id, refereeId: me.id });
    await tx.update(users).set({ referredById: inviter.id }).where(eq(users.id, me.id));
    return { referrerId: inviter.id };
  });
}

export interface ReferralPayout {
  referrerTicks: number;
  refereeTicks: number;
  note: string | null;
}

/**
 * Pay the referral for `refereeId` if it's due: they were invited, haven't been paid, and have now
 * traded enough. Safe to call after every trade; returns null when nothing was paid.
 */
export async function payReferralIfDue(
  db: AnyDb,
  input: { refereeId: string },
  cfg: ReferralConfig = DEFAULT_REFERRAL,
): Promise<ReferralPayout | null> {
  return runTx(db, async (tx) => {
    const [ref] = await tx
      .select()
      .from(referrals)
      .where(and(eq(referrals.refereeId, input.refereeId), eq(referrals.status, "pending")))
      .for("update");
    if (!ref) return null;

    const [vol] = await tx
      .select({ v: sql<string>`COALESCE(SUM(ABS(${tradeLegs.cash})), 0)::text` })
      .from(tradeLegs)
      .where(eq(tradeLegs.userId, input.refereeId));
    if (Number(vol?.v ?? 0) < cfg.minVolumeTicks) return null;

    const [referee] = await tx.select().from(users).where(eq(users.id, ref.refereeId));
    if (!referee || referee.isBot || referee.suspendedAt) return null; // stays pending

    const [referrer] = await tx.select().from(users).where(eq(users.id, ref.referrerId));
    const referrerOk = !!referrer && !referrer.isBot && !referrer.suspendedAt;
    const [paidRow] = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(referrals)
      .where(and(eq(referrals.referrerId, ref.referrerId), eq(referrals.status, "paid"), sql`${referrals.referrerTicks} > 0`));
    const underCap = (paidRow?.n ?? 0) < cfg.cap;

    const referrerTicks = referrerOk && underCap ? cfg.referrerTicks : 0;
    const refereeTicks = cfg.refereeTicks;
    const note = !referrerOk ? "inviter can't earn right now" : !underCap ? "inviter reached the referral cap" : null;

    const issuance = await referralAccount(tx);
    const deltas = new Deltas().add(issuance, -(referrerTicks + refereeTicks));
    const refereeAcc = await userAccounts(tx, ref.refereeId);
    deltas.add(refereeAcc.available, refereeTicks);
    if (referrerTicks > 0) deltas.add((await userAccounts(tx, ref.referrerId)).available, referrerTicks);
    await postEntry(
      tx,
      { kind: "referral", userId: ref.refereeId, memo: "referral reward", idempotencyKey: `referral:${ref.id}` },
      deltas,
    );
    await tx
      .update(referrals)
      .set({ status: "paid", referrerTicks, refereeTicks, note, paidAt: new Date() })
      .where(eq(referrals.id, ref.id));
    await logEvent(tx, {
      actorId: null,
      action: "referral.pay",
      targetType: "user",
      targetId: ref.refereeId,
      details: { referrerId: ref.referrerId, referrerTicks, refereeTicks, note },
    });
    return { referrerTicks, refereeTicks, note };
  });
}

export interface ReferralSummary {
  code: string;
  cap: number;
  /** Invited people who've been paid for (the inviter earned on these). */
  rewarded: number;
  pending: number;
  earnedTicks: number;
  /** What the invited person got, if the viewer was invited. */
  invitedBy: { name: string | null; id: string; bonusTicks: number; status: string } | null;
  people: { id: string; name: string | null; status: string; earnedTicks: number; joinedAt: Date }[];
}

export async function referralSummary(db: AnyDb, userId: string, cfg: ReferralConfig = DEFAULT_REFERRAL): Promise<ReferralSummary> {
  const code = await ensureReferralCode(db, userId);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      status: referrals.status,
      earned: referrals.referrerTicks,
      joinedAt: referrals.createdAt,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .where(eq(referrals.referrerId, userId))
    .orderBy(desc(referrals.createdAt))
    .limit(50);
  const [mine] = await db
    .select({ id: users.id, name: users.name, status: referrals.status, bonus: referrals.refereeTicks })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.referrerId))
    .where(eq(referrals.refereeId, userId));
  return {
    code,
    cap: cfg.cap,
    rewarded: rows.filter((r) => r.status === "paid" && r.earned > 0).length,
    pending: rows.filter((r) => r.status === "pending").length,
    earnedTicks: rows.reduce((s, r) => s + r.earned, 0),
    invitedBy: mine ? { id: mine.id, name: mine.name, status: mine.status, bonusTicks: mine.bonus } : null,
    people: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, earnedTicks: r.earned, joinedAt: r.joinedAt })),
  };
}
