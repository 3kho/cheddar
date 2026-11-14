import "server-only";
import { and, eq, sql, users } from "@cheddar/db";
import { getDb } from "./db";

export interface UserProfile {
  id: string;
  name: string | null;
  slackId: string | null;
  createdAt: Date;
  isSuspended: boolean;
  isCheesemonger: boolean;
  /** All-time, over wheels that have ripened (same formula as the leaderboard). */
  profit: number;
  volume: number;
  trades: number;
  wheelsTraded: number;
  /** Ripened wheels they traded, and how many of those ended in profit. */
  settledCount: number;
  winCount: number;
  positions: { wheelSlug: string; wheelTitle: string; label: string; yes: number; no: number }[];
  recent: { wheelSlug: string; wheelTitle: string; label: string; outcome: "YES" | "NO"; shares: number; cash: number; at: Date }[];
}

type Rows<T> = { rows: T[] };

/** Public profile of a person (never a bot): headline stats, open positions and recent trades. */
export async function userProfile(id: string): Promise<UserProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.isBot, false)));
  if (!u) return null;

  const [stats, perWheel, positionRows, recent] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(ABS(l.cash)), 0)::text AS volume, COUNT(DISTINCT l.trade_id)::int AS trades,
             COUNT(DISTINCT wd.wheel_id)::int AS wheels
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id JOIN wedges wd ON wd.id = t.wedge_id
      WHERE l.user_id = ${id}`),
    // Net result per ripened wheel: payouts plus (negative) cash spent and received trading.
    db.execute(sql`
      WITH mine AS (
        SELECT wd.wheel_id, SUM(l.cash) AS c
        FROM trade_legs l JOIN trades t ON t.id = l.trade_id JOIN wedges wd ON wd.id = t.wedge_id
        JOIN wheels wh ON wh.id = wd.wheel_id AND wh.status IN ('resolved', 'moldy')
        WHERE l.user_id = ${id} GROUP BY wd.wheel_id
      ), paid AS (
        SELECT wd.wheel_id, SUM(ll.amount) AS p
        FROM journal_entries e JOIN ledger_lines ll ON ll.entry_id = e.id
        JOIN accounts a ON a.id = ll.account_id AND a.kind = 'user_available' AND a.user_id = ${id}
        JOIN wedges wd ON wd.id = e.wedge_id
        WHERE e.kind IN ('payout', 'moldy_refund') GROUP BY wd.wheel_id
      )
      SELECT (COALESCE(paid.p, 0) + mine.c)::text AS net
      FROM mine LEFT JOIN paid ON paid.wheel_id = mine.wheel_id`),
    db.execute(sql`
      SELECT wh.slug AS "wheelSlug", wh.title AS "wheelTitle", wd.label, p.yes_shares AS yes, p.no_shares AS no
      FROM positions p JOIN wedges wd ON wd.id = p.wedge_id JOIN wheels wh ON wh.id = wd.wheel_id
      WHERE p.user_id = ${id} AND (p.yes_shares > 0 OR p.no_shares > 0) AND wh.status IN ('open', 'closed', 'ripening')
      ORDER BY (p.yes_shares + p.no_shares) DESC LIMIT 20`),
    db.execute(sql`
      SELECT wh.slug AS "wheelSlug", wh.title AS "wheelTitle", wd.label, l.outcome, l.shares, l.cash::text AS cash, t.created_at AS at
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id JOIN wedges wd ON wd.id = t.wedge_id JOIN wheels wh ON wh.id = wd.wheel_id
      WHERE l.user_id = ${id} ORDER BY t.id DESC LIMIT 15`),
  ]);

  const s = (stats as unknown as Rows<{ volume: string; trades: number; wheels: number }>).rows[0]!;
  const nets = (perWheel as unknown as Rows<{ net: string }>).rows.map((r) => Number(r.net));
  return {
    id: u.id,
    name: u.name,
    slackId: u.slackId,
    createdAt: u.createdAt,
    isSuspended: !!u.suspendedAt,
    isCheesemonger: u.isCheesemonger,
    profit: nets.reduce((a, b) => a + b, 0),
    volume: Number(s.volume),
    trades: s.trades,
    wheelsTraded: s.wheels,
    settledCount: nets.length,
    winCount: nets.filter((n) => n > 0).length,
    positions: (positionRows as unknown as Rows<UserProfile["positions"][number]>).rows,
    recent: (
      recent as unknown as Rows<{
        wheelSlug: string;
        wheelTitle: string;
        label: string;
        outcome: "YES" | "NO";
        shares: number;
        cash: string;
        at: string | Date;
      }>
    ).rows.map((r) => ({ ...r, cash: Number(r.cash), at: new Date(r.at) })),
  };
}

/** What a new person still has to do to get going: used by the "Getting started" card. */
export async function onboardingState(userId: string) {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM trade_legs WHERE user_id = ${userId}) AS traded,
           COALESCE((SELECT balance FROM accounts WHERE user_id = ${userId} AND kind = 'user_available'), 0)::text AS cash,
           EXISTS (SELECT 1 FROM referrals WHERE referrer_id = ${userId}) AS invited
  `)) as unknown as { rows: { traded: boolean; cash: string; invited: boolean }[] };
  const x = r.rows[0]!;
  return { traded: x.traded, cash: Number(x.cash), invited: x.invited };
}
