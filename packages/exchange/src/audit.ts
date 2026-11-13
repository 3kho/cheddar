import { sql, type SQL } from "@cheddar/db";
import type { AnyDb } from "@cheddar/db";

/**
 * Checks every money and share invariant. Returns human-readable violations
 * (empty = healthy). Cheap enough to run in tests and from an admin page.
 */
export async function audit(db: AnyDb): Promise<string[]> {
  const problems: string[] = [];
  const check = async (name: string, query: SQL) => {
    const r = (await db.execute(query)) as unknown as { rows: Record<string, unknown>[] };
    for (const row of r.rows) problems.push(`${name}: ${JSON.stringify(row)}`);
  };

  // Double entry: everything sums to zero, so Latta only enters via churn (or house backing).
  await check(
    "total balance is not zero",
    sql`SELECT SUM(balance)::text AS total FROM accounts HAVING SUM(balance) <> 0`,
  );
  // Balance cache agrees with the append-only lines.
  await check(
    "balance cache drift",
    sql`SELECT a.id, a.kind, a.balance::text AS cached, COALESCE(SUM(l.amount), 0)::text AS lines
        FROM accounts a LEFT JOIN ledger_lines l ON l.account_id = a.id
        GROUP BY a.id HAVING a.balance <> COALESCE(SUM(l.amount), 0)`,
  );
  // Each user's locked account equals what their open buy orders escrow.
  await check(
    "locked balance != open buy escrow",
    sql`SELECT a.user_id, a.balance::text AS locked, COALESCE(o.escrow, 0)::text AS escrow
        FROM accounts a
        LEFT JOIN (SELECT user_id, SUM(locked_ticks) AS escrow FROM orders WHERE status = 'open' GROUP BY user_id) o
          ON o.user_id = a.user_id
        WHERE a.kind = 'user_locked' AND a.balance <> COALESCE(o.escrow, 0)`,
  );
  // Closed orders hold nothing; open orders have something left.
  await check(
    "closed order still escrows",
    sql`SELECT id, status FROM orders WHERE status <> 'open' AND (locked_ticks <> 0 OR locked_shares <> 0)`,
  );
  await check(
    "open buy escrow != remaining * price",
    sql`SELECT id, locked_ticks::text, remaining, price FROM orders
        WHERE status = 'open' AND side = 'BUY' AND locked_ticks <> remaining::bigint * price`,
  );
  await check(
    "open sell lock != remaining",
    sql`SELECT id, locked_shares, remaining FROM orders
        WHERE status = 'open' AND side = 'SELL' AND locked_shares <> remaining`,
  );
  // Reserved shares equal what open sell orders reserve.
  await check(
    "position locks != open sell orders",
    sql`SELECT p.user_id, p.wedge_id, p.yes_locked, p.no_locked, COALESCE(o.y, 0) AS y, COALESCE(o.n, 0) AS n
        FROM positions p
        LEFT JOIN (
          SELECT user_id, wedge_id,
                 SUM(CASE WHEN outcome = 'YES' THEN locked_shares ELSE 0 END) AS y,
                 SUM(CASE WHEN outcome = 'NO' THEN locked_shares ELSE 0 END) AS n
          FROM orders WHERE status = 'open' AND side = 'SELL' GROUP BY user_id, wedge_id
        ) o ON o.user_id = p.user_id AND o.wedge_id = p.wedge_id
        WHERE p.yes_locked <> COALESCE(o.y, 0) OR p.no_locked <> COALESCE(o.n, 0)`,
  );
  // Unresolved wedges: YES and NO shares come in pairs, each backed by 100 ticks.
  await check(
    "wedge shares unpaired or under-collateralised",
    sql`SELECT w.id, COALESCE(p.y, 0)::text AS yes, COALESCE(p.n, 0)::text AS no, COALESCE(a.balance, 0)::text AS collateral
        FROM wedges w
        LEFT JOIN (SELECT wedge_id, SUM(yes_shares) AS y, SUM(no_shares) AS n FROM positions GROUP BY wedge_id) p
          ON p.wedge_id = w.id
        LEFT JOIN accounts a ON a.kind = 'wedge_collateral' AND a.wedge_id = w.id
        WHERE w.status IN ('open', 'halted')
          AND (COALESCE(p.y, 0) <> COALESCE(p.n, 0) OR COALESCE(a.balance, 0) <> 100 * COALESCE(p.y, 0))`,
  );
  // New Latta only ever comes from Churn entries.
  await check(
    "issuance account touched by a non-churn entry",
    sql`SELECT e.id, e.kind FROM ledger_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE a.kind = 'churn_issuance' AND e.kind <> 'churn'`,
  );
  await check(
    "issued Latta != credited churn syncs",
    sql`SELECT (-a.balance)::text AS issued, COALESCE(s.credited, 0)::text AS credited
        FROM accounts a, (SELECT SUM(credited_ticks) AS credited FROM churn_syncs) s
        WHERE a.kind = 'churn_issuance' AND -a.balance <> COALESCE(s.credited, 0)`,
  );
  // House backing only moves through house_backing / house_repay, and is never "owed" to anyone.
  await check(
    "house account touched by a non-house entry",
    sql`SELECT e.id, e.kind FROM ledger_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE a.kind = 'house_issuance' AND e.kind NOT IN ('house_backing', 'house_repay')`,
  );
  await check(
    "house account has repaid more than it lent",
    sql`SELECT balance::text FROM accounts WHERE kind = 'house_issuance' AND balance > 0`,
  );
  // Settled wedges have paid out everything and have nothing left on the book.
  await check(
    "settled wedge still holds collateral or orders",
    sql`SELECT w.id, w.status, COALESCE(a.balance, 0)::text AS collateral,
               (SELECT COUNT(*) FROM orders o WHERE o.wedge_id = w.id AND o.status = 'open')::int AS open_orders
        FROM wedges w
        LEFT JOIN accounts a ON a.kind = 'wedge_collateral' AND a.wedge_id = w.id
        WHERE w.status IN ('resolved_yes', 'resolved_no', 'moldy')
          AND (COALESCE(a.balance, 0) <> 0
               OR EXISTS (SELECT 1 FROM orders o WHERE o.wedge_id = w.id AND o.status = 'open'))`,
  );
  // Every wedge of a settled wheel is settled, and vice versa.
  await check(
    "wheel and wedge statuses disagree",
    sql`SELECT wh.id, wh.status, w.id AS wedge_id, w.status AS wedge_status
        FROM wheels wh JOIN wedges w ON w.wheel_id = wh.id
        WHERE (wh.status IN ('resolved', 'moldy')) <> (w.status IN ('resolved_yes', 'resolved_no', 'moldy'))
           OR (wh.status = 'ripening' AND w.status <> 'halted')
           OR (wh.status = 'resolved' AND w.status = 'moldy')
           OR (wh.status = 'moldy' AND w.status <> 'moldy')`,
  );
  await check(
    "resolved wheel without exactly one winner (multi-outcome)",
    sql`SELECT wh.id, COUNT(*) FILTER (WHERE w.status = 'resolved_yes')::int AS winners, COUNT(*)::int AS wedges
        FROM wheels wh JOIN wedges w ON w.wheel_id = wh.id
        WHERE wh.status = 'resolved'
        GROUP BY wh.id
        HAVING COUNT(*) > 1 AND COUNT(*) FILTER (WHERE w.status = 'resolved_yes') <> 1`,
  );
  return problems;
}
