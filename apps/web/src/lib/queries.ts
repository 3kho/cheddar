import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  or,
  sql,
  accounts,
  auditLog,
  outcomeRequests,
  churnSyncs,
  journalEntries,
  ledgerLines,
  mouseFunders,
  orders,
  positions,
  proposals,
  settlements,
  tradeLegs,
  trades,
  users,
  wedges,
  wheels,
} from "@cheddar/db";
import { getDb } from "./db";
import { chanceOf } from "./format";
import type { Depth, Level } from "./market";

export interface WedgeView {
  id: string;
  label: string;
  status: string;
  lastYesPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  chance: number | null;
  /** Percentage points vs. the last trade at least 24h ago (null if no such trade). */
  change24h: number | null;
  volumeTicks: number;
  volume24hTicks: number;
}

export interface WheelView {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  resolutionCriteria: string;
  /** Null for wheels that stay open until someone asks to close them. */
  closesAt: Date | null;
  icon: string | null;
  status: string;
  createdAt: Date;
  creatorId: string;
  tradingPausedAt: Date | null;
  pauseReason: string | null;
  resolvedAt: Date | null;
  /** The Mouse's LMSR depth (0 = not quoting). */
  liquidity: number;
  /** Multi-outcome wheels where people can suggest new outcomes. */
  allowAdditions: boolean;
  volumeTicks: number;
  volume24hTicks: number;
  wedges: WedgeView[];
}

const OPEN_STATUSES = ["open", "closed", "ripening"] as const;
const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

async function wedgeViews(wheelIds: string[]): Promise<Map<string, WedgeView[]>> {
  const out = new Map<string, WedgeView[]>();
  if (!wheelIds.length) return out;
  const db = await getDb();
  const ws = await db
    .select()
    .from(wedges)
    .where(inArray(wedges.wheelId, wheelIds))
    .orderBy(asc(wedges.sortOrder), asc(wedges.createdAt));
  if (!ws.length) return out;
  const ids = ws.map((w) => w.id);
  type Rows<T> = { rows: T[] };
  const [tops, vols, past] = await Promise.all([
    db
      .select({
        wedgeId: orders.wedgeId,
        bid: sql<number | null>`MAX(CASE WHEN (${orders.outcome} = 'YES' AND ${orders.side} = 'BUY') THEN ${orders.price}
                                        WHEN (${orders.outcome} = 'NO' AND ${orders.side} = 'SELL') THEN 100 - ${orders.price} END)::int`,
        ask: sql<number | null>`MIN(CASE WHEN (${orders.outcome} = 'YES' AND ${orders.side} = 'SELL') THEN ${orders.price}
                                        WHEN (${orders.outcome} = 'NO' AND ${orders.side} = 'BUY') THEN 100 - ${orders.price} END)::int`,
      })
      .from(orders)
      .where(and(eq(orders.status, "open"), inArray(orders.wedgeId, ids)))
      .groupBy(orders.wedgeId),
    // Volume = half the absolute cash moved: a transfer counts its price once, a mint/burn 50 per side.
    db.execute(sql`
      SELECT t.wedge_id,
             (COALESCE(SUM(ABS(l.cash)), 0) / 2)::text AS v,
             (COALESCE(SUM(ABS(l.cash)) FILTER (WHERE t.created_at > now() - interval '24 hours'), 0) / 2)::text AS v24
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id
      WHERE t.wedge_id IN (${idList(ids)})
      GROUP BY t.wedge_id`) as unknown as Promise<Rows<{ wedge_id: string; v: string; v24: string }>>,
    db.execute(sql`
      SELECT DISTINCT ON (wedge_id) wedge_id, yes_price
      FROM trades
      WHERE wedge_id IN (${idList(ids)}) AND created_at <= now() - interval '24 hours'
      ORDER BY wedge_id, created_at DESC`) as unknown as Promise<Rows<{ wedge_id: string; yes_price: number }>>,
  ]);
  const top = new Map(tops.map((t) => [t.wedgeId, t]));
  const vol = new Map(vols.rows.map((r) => [r.wedge_id, r]));
  const then = new Map(past.rows.map((r) => [r.wedge_id, Number(r.yes_price)]));
  for (const w of ws) {
    const t = top.get(w.id);
    const bestBid = t?.bid ?? null;
    const bestAsk = t?.ask ?? null;
    const settled =
      w.status === "resolved_yes" ? 100 : w.status === "resolved_no" ? 0 : w.status === "moldy" ? 50 : null;
    const chance = settled ?? chanceOf(bestBid, bestAsk, w.lastYesPrice);
    const before = then.get(w.id);
    const v = vol.get(w.id);
    const list = out.get(w.wheelId) ?? [];
    list.push({
      id: w.id,
      label: w.label,
      status: w.status,
      lastYesPrice: w.lastYesPrice,
      bestBid,
      bestAsk,
      chance,
      change24h: chance != null && before != null && settled == null ? chance - before : null,
      volumeTicks: Number(v?.v ?? 0),
      volume24hTicks: Number(v?.v24 ?? 0),
    });
    out.set(w.wheelId, list);
  }
  return out;
}

function toWheelView(w: typeof wheels.$inferSelect, ws: WedgeView[]): WheelView {
  return {
    ...w,
    volumeTicks: ws.reduce((n, x) => n + x.volumeTicks, 0),
    volume24hTicks: ws.reduce((n, x) => n + x.volume24hTicks, 0),
    wedges: ws,
  };
}

export type WheelSort = "trending" | "new" | "volume" | "resolved";

const DONE_STATUSES = ["resolved", "moldy"] as const;

export async function listWheels(
  opts: { category?: string; q?: string; sort?: WheelSort; limit?: number; excludeId?: string } = {},
): Promise<WheelView[]> {
  const db = await getDb();
  const done = opts.sort === "resolved";
  const conds = [inArray(wheels.status, done ? [...DONE_STATUSES] : [...OPEN_STATUSES])];
  if (opts.category) conds.push(eq(wheels.category, opts.category));
  if (opts.q) conds.push(sql`${wheels.title} ILIKE ${like(opts.q)}`);
  if (opts.excludeId) conds.push(sql`${wheels.id} <> ${opts.excludeId}`);
  const ws = await db
    .select()
    .from(wheels)
    .where(and(...conds))
    .orderBy(done ? sql`${wheels.resolvedAt} DESC NULLS LAST` : desc(wheels.createdAt))
    .limit(200);
  const wv = await wedgeViews(ws.map((w) => w.id));
  const views = ws.map((w) => toWheelView(w, wv.get(w.id) ?? []));
  if (done) return opts.limit ? views.slice(0, opts.limit) : views;
  const sort = opts.sort ?? "trending";
  const by: Record<Exclude<WheelSort, "resolved">, (a: WheelView, b: WheelView) => number> = {
    // Recent activity counts triple, but a wheel needs real overall volume to trend.
    trending: (a, b) => b.volume24hTicks * 3 + b.volumeTicks - (a.volume24hTicks * 3 + a.volumeTicks),
    volume: (a, b) => b.volumeTicks - a.volumeTicks,
    new: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  };
  views.sort((a, b) => by[sort as Exclude<WheelSort, "resolved">](a, b) || b.createdAt.getTime() - a.createdAt.getTime());
  return opts.limit ? views.slice(0, opts.limit) : views;
}

export async function listCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ c: wheels.category })
    .from(wheels)
    .where(and(inArray(wheels.status, [...OPEN_STATUSES]), sql`${wheels.category} IS NOT NULL`));
  return rows.map((r) => r.c!).sort();
}

export async function depthFor(wedgeIds: string[]): Promise<Map<string, Depth>> {
  const out = new Map<string, Depth>(wedgeIds.map((id) => [id, { bids: [], asks: [] }]));
  if (!wedgeIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select({
      wedgeId: orders.wedgeId,
      isBid: sql<boolean>`((${orders.outcome} = 'YES' AND ${orders.side} = 'BUY') OR (${orders.outcome} = 'NO' AND ${orders.side} = 'SELL'))`,
      yesPrice: sql<number>`(CASE WHEN ${orders.outcome} = 'YES' THEN ${orders.price} ELSE 100 - ${orders.price} END)::int`,
      qty: sql<number>`SUM(${orders.remaining})::int`,
    })
    .from(orders)
    .where(and(eq(orders.status, "open"), inArray(orders.wedgeId, wedgeIds)))
    .groupBy(sql`1`, sql`2`, sql`3`);
  for (const r of rows) {
    const d = out.get(r.wedgeId)!;
    (r.isBid ? d.bids : d.asks).push([r.yesPrice, r.qty] as Level);
  }
  for (const d of out.values()) {
    d.bids.sort((a, b) => b[0] - a[0]);
    d.asks.sort((a, b) => a[0] - b[0]);
  }
  return out;
}

export async function getWheel(slug: string) {
  const db = await getDb();
  const [w] = await db
    .select({ wheel: wheels, creatorName: users.name })
    .from(wheels)
    .innerJoin(users, eq(users.id, wheels.creatorId))
    .where(eq(wheels.slug, slug));
  if (!w) return null;
  const ws = (await wedgeViews([w.wheel.id])).get(w.wheel.id) ?? [];
  const ids = ws.map((x) => x.id);
  const [depth, history, settlement] = await Promise.all([
    depthFor(ids),
    ids.length
      ? db
          .select({ wedgeId: trades.wedgeId, yesPrice: trades.yesPrice, at: trades.createdAt })
          .from(trades)
          .where(inArray(trades.wedgeId, ids))
          .orderBy(asc(trades.createdAt))
          .limit(5_000)
      : Promise.resolve([]),
    db
      .select()
      .from(settlements)
      .where(and(eq(settlements.wheelId, w.wheel.id), or(eq(settlements.status, "pending"), eq(settlements.status, "approved"))))
      .orderBy(desc(settlements.createdAt))
      .limit(1),
  ]);
  const s = settlement[0] ?? null;
  const people = s ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [s.proposerId, ...(s.reviewerId ? [s.reviewerId] : [])])) : [];
  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.name ?? null;
  return {
    wheel: toWheelView(w.wheel, ws),
    creatorName: w.creatorName,
    depth,
    history,
    settlement: s,
    /** Who proposed the result and which Cheesemonger approved it, shown on the wheel. */
    settlementProposedBy: nameOf(s?.proposerId),
    settlementBy: nameOf(s?.reviewerId),
  };
}

export async function balancesOf(userId: string) {
  const db = await getDb();
  const rows = await db.select().from(accounts).where(eq(accounts.userId, userId));
  return {
    available: rows.find((r) => r.kind === "user_available")?.balance ?? 0,
    locked: rows.find((r) => r.kind === "user_locked")?.balance ?? 0,
  };
}

/** The viewer's shares and open orders on a set of wedges. */
export async function userMarketState(userId: string, wedgeIds: string[]) {
  const db = await getDb();
  if (!wedgeIds.length) return { positions: [], orders: [] };
  const [pos, open] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), inArray(positions.wedgeId, wedgeIds))),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.status, "open"), inArray(orders.wedgeId, wedgeIds)))
      .orderBy(desc(orders.createdAt)),
  ]);
  return { positions: pos, orders: open };
}

export async function portfolio(userId: string) {
  const db = await getDb();
  const [bal, held, open, activity, lastSync, earned] = await Promise.all([
    balancesOf(userId),
    db
      .select({ p: positions, wedge: wedges, wheel: wheels })
      .from(positions)
      .innerJoin(wedges, eq(wedges.id, positions.wedgeId))
      .innerJoin(wheels, eq(wheels.id, wedges.wheelId))
      .where(and(eq(positions.userId, userId), or(gt(positions.yesShares, 0), gt(positions.noShares, 0)))),
    db
      .select({ o: orders, wedge: wedges, wheel: wheels })
      .from(orders)
      .innerJoin(wedges, eq(wedges.id, orders.wedgeId))
      .innerJoin(wheels, eq(wheels.id, wedges.wheelId))
      .where(and(eq(orders.userId, userId), eq(orders.status, "open")))
      .orderBy(desc(orders.createdAt)),
    db
      .select({
        id: ledgerLines.id,
        amount: ledgerLines.amount,
        kind: journalEntries.kind,
        memo: journalEntries.memo,
        at: journalEntries.createdAt,
        wedgeLabel: wedges.label,
        wheelTitle: wheels.title,
        wheelSlug: wheels.slug,
      })
      .from(ledgerLines)
      .innerJoin(journalEntries, eq(journalEntries.id, ledgerLines.entryId))
      .innerJoin(accounts, eq(accounts.id, ledgerLines.accountId))
      .leftJoin(wedges, eq(wedges.id, journalEntries.wedgeId))
      .leftJoin(wheels, eq(wheels.id, wedges.wheelId))
      .where(and(eq(accounts.userId, userId), eq(accounts.kind, "user_available")))
      .orderBy(desc(ledgerLines.id))
      .limit(50),
    db.select().from(churnSyncs).where(eq(churnSyncs.userId, userId)).orderBy(desc(churnSyncs.fetchedAt)).limit(1),
    db
      .select({ s: sql<string>`COALESCE(SUM(${churnSyncs.creditedTicks}), 0)::text` })
      .from(churnSyncs)
      .where(eq(churnSyncs.userId, userId)),
  ]);
  const views = await wedgeViews([...new Set(held.map((h) => h.wheel.id))]);
  const chanceById = new Map([...views.values()].flat().map((w) => [w.id, w.chance]));
  return {
    balances: bal,
    positions: held
      .filter((h) => h.wedge.status === "open" || h.wedge.status === "halted")
      .map((h) => {
        const c = chanceById.get(h.wedge.id) ?? null;
        const value = c == null ? null : h.p.yesShares * c + h.p.noShares * (100 - c);
        return { ...h, chance: c, valueTicks: value };
      }),
    orders: open,
    activity,
    lastSync: lastSync[0] ?? null,
    churnEarnedTicks: Number(earned[0]?.s ?? 0),
  };
}

// ---------- Cheesemonger dashboard ----------

export const PAGE_SIZE = { proposals: 10, users: 25, wheels: 25, logs: 50 } as const;

/** ILIKE pattern for a user-typed search, with LIKE wildcards escaped. */
const like = (q: string) => "%" + q.replace(/[%_\\]/g, "\\$&") + "%";

export async function dashboardCounts() {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM proposals WHERE status = 'pending')::int AS proposals,
      (SELECT COUNT(*) FROM settlements WHERE status = 'pending')::int AS settlements,
      (SELECT COUNT(*) FROM outcome_requests WHERE status = 'pending')::int AS outcomes,
      (SELECT COUNT(*) FROM reports WHERE status = 'open')::int AS reports,
      (SELECT COUNT(*) FROM mouse_funders WHERE active)::int AS funders,
      (SELECT COUNT(*) FROM users WHERE suspended_at IS NOT NULL)::int AS suspended,
      (SELECT COUNT(*) FROM wheels WHERE trading_paused_at IS NOT NULL AND status NOT IN ('resolved', 'moldy'))::int AS paused
  `)) as unknown as { rows: { proposals: number; settlements: number; outcomes: number; reports: number; funders: number; suspended: number; paused: number }[] };
  return r.rows[0]!;
}

/** A pending proposal, for the Cheesemonger edit page. */
export async function proposalById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
  return p ?? null;
}

/** Suggested outcomes waiting for a Cheesemonger, oldest first, with the wheel's current outcomes. */
export async function pendingOutcomeRequests() {
  const db = await getDb();
  const rows = await db
    .select({ r: outcomeRequests, wheel: wheels, proposer: users.name, proposerSlack: users.slackId })
    .from(outcomeRequests)
    .innerJoin(wheels, eq(wheels.id, outcomeRequests.wheelId))
    .innerJoin(users, eq(users.id, outcomeRequests.proposerId))
    .where(eq(outcomeRequests.status, "pending"))
    .orderBy(asc(outcomeRequests.createdAt))
    .limit(100);
  const views = await wedgeViews([...new Set(rows.map((x) => x.wheel.id))]);
  return rows.map((x) => ({ ...x, outcomes: views.get(x.wheel.id) ?? [] }));
}

/** Pending suggestions on one wheel (shown on its page). */
export async function wheelOutcomeRequests(wheelId: string) {
  const db = await getDb();
  return db
    .select({ id: outcomeRequests.id, label: outcomeRequests.label, proposerId: outcomeRequests.proposerId, createdAt: outcomeRequests.createdAt })
    .from(outcomeRequests)
    .where(and(eq(outcomeRequests.wheelId, wheelId), eq(outcomeRequests.status, "pending")))
    .orderBy(asc(outcomeRequests.createdAt))
    .limit(50);
}

/** Oldest first, so nothing waits forever. */
export async function pendingProposals(page: number) {
  const db = await getDb();
  const [rows, total] = await Promise.all([
    db
      .select({ p: proposals, proposer: users.name, proposerSlack: users.slackId })
      .from(proposals)
      .innerJoin(users, eq(users.id, proposals.proposerId))
      .where(eq(proposals.status, "pending"))
      .orderBy(asc(proposals.createdAt))
      .limit(PAGE_SIZE.proposals)
      .offset((page - 1) * PAGE_SIZE.proposals),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(proposals).where(eq(proposals.status, "pending")),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

export async function pendingSettlements() {
  const db = await getDb();
  const [rows, previews] = await Promise.all([
    db
      .select({ s: settlements, wheel: wheels, proposer: users.name, wedgeLabel: wedges.label })
      .from(settlements)
      .innerJoin(wheels, eq(wheels.id, settlements.wheelId))
      .innerJoin(users, eq(users.id, settlements.proposerId))
      .leftJoin(wedges, eq(wedges.id, settlements.winningWedgeId))
      .where(eq(settlements.status, "pending"))
      .orderBy(asc(settlements.createdAt)),
    // What approving would pay, computed the same way approveSettlement does.
    db.execute(sql`
      SELECT s.id, COALESCE(SUM(x.pay), 0)::text AS paid, COUNT(DISTINCT x.user_id) FILTER (WHERE x.pay > 0)::int AS holders
      FROM settlements s
      LEFT JOIN LATERAL (
        SELECT p.user_id,
               CASE WHEN s.outcome = 'moldy' THEN (p.yes_shares + p.no_shares) * 50
                    WHEN s.outcome = 'wedge_wins' AND p.wedge_id = s.winning_wedge_id THEN p.yes_shares * 100
                    ELSE p.no_shares * 100 END AS pay
        FROM positions p JOIN wedges w ON w.id = p.wedge_id
        WHERE w.wheel_id = s.wheel_id
      ) x ON true
      WHERE s.status = 'pending'
      GROUP BY s.id`) as unknown as Promise<{ rows: { id: string; paid: string; holders: number }[] }>,
  ]);
  const byId = new Map(previews.rows.map((r) => [r.id, { paidTicks: Number(r.paid), holders: Number(r.holders) }]));
  return rows.map((r) => ({ ...r, preview: byId.get(r.s.id) ?? { paidTicks: 0, holders: 0 } }));
}

export async function activeFunders() {
  const db = await getDb();
  return db
    .select({
      f: mouseFunders,
      name: users.name,
      signedUp: sql<boolean>`${users.hcaSub} IS NOT NULL`,
      /** Latta this funder's hours have sent to The Mouse. */
      fedTicks: sql<string>`(
        SELECT COALESCE(SUM(-l.amount), 0)::text FROM ledger_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE e.kind = 'churn' AND e.memo = 'fed the mouse' AND e.user_id = ${users.id} AND a.kind = 'churn_issuance')`,
      lastStatus: sql<string | null>`(SELECT s.status::text FROM churn_syncs s WHERE s.user_id = ${users.id} ORDER BY s.fetched_at DESC LIMIT 1)`,
      lastError: sql<string | null>`(SELECT s.error FROM churn_syncs s WHERE s.user_id = ${users.id} ORDER BY s.fetched_at DESC LIMIT 1)`,
      lastAt: sql<Date | null>`(SELECT s.fetched_at FROM churn_syncs s WHERE s.user_id = ${users.id} ORDER BY s.fetched_at DESC LIMIT 1)`,
    })
    .from(mouseFunders)
    .leftJoin(users, eq(users.slackId, mouseFunders.slackId))
    .where(eq(mouseFunders.active, true))
    .orderBy(asc(mouseFunders.addedAt));
}

export async function searchUsers(opts: { q?: string; filter?: "all" | "suspended" | "cheesemongers"; page: number }) {
  const db = await getDb();
  const conds = [eq(users.isBot, false)];
  if (opts.q) conds.push(or(sql`${users.name} ILIKE ${like(opts.q)}`, sql`${users.slackId} ILIKE ${like(opts.q)}`)!);
  if (opts.filter === "suspended") conds.push(sql`${users.suspendedAt} IS NOT NULL`);
  if (opts.filter === "cheesemongers") conds.push(eq(users.isCheesemonger, true));
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db
      .select({ u: users, balance: accounts.balance, funder: mouseFunders.slackId })
      .from(users)
      .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.kind, "user_available")))
      .leftJoin(mouseFunders, and(eq(mouseFunders.slackId, users.slackId), eq(mouseFunders.active, true)))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE.users)
      .offset((opts.page - 1) * PAGE_SIZE.users),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(users).where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

/** Live wheels for moderation, paused ones first. */
export async function moderationWheels(opts: { q?: string; page: number }) {
  const db = await getDb();
  const conds = [inArray(wheels.status, ["open", "closed", "ripening"])];
  if (opts.q) conds.push(sql`${wheels.title} ILIKE ${like(opts.q)}`);
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db
      .select({
        w: wheels,
        creator: users.name,
        outcomes: sql<number>`(SELECT COUNT(*) FROM wedges x WHERE x.wheel_id = ${wheels.id})::int`,
      })
      .from(wheels)
      .innerJoin(users, eq(users.id, wheels.creatorId))
      .where(where)
      .orderBy(sql`${wheels.tradingPausedAt} IS NULL`, desc(wheels.createdAt))
      .limit(PAGE_SIZE.wheels)
      .offset((opts.page - 1) * PAGE_SIZE.wheels),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(wheels).where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

export async function auditLogPage(opts: { action?: string; page: number }) {
  const db = await getDb();
  const where = opts.action ? sql`${auditLog.action} LIKE ${opts.action.replace(/[%_\\]/g, "") + "%"}` : undefined;
  const [rows, total] = await Promise.all([
    db
      .select({ l: auditLog, actor: users.name, actorSlack: users.slackId })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(PAGE_SIZE.logs)
      .offset((opts.page - 1) * PAGE_SIZE.logs),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(auditLog).where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

export async function myProposals(userId: string) {
  const db = await getDb();
  return db
    .select({ p: proposals, wheelSlug: wheels.slug })
    .from(proposals)
    .leftJoin(wheels, eq(wheels.proposalId, proposals.id))
    .where(eq(proposals.proposerId, userId))
    .orderBy(desc(proposals.createdAt))
    .limit(20);
}

export async function leaderboard() {
  const db = await getDb();
  return db
    .select({ id: users.id, name: users.name, slackId: users.slackId, balance: accounts.balance })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(eq(accounts.kind, "user_available"), eq(users.isBot, false), gt(accounts.balance, 0)))
    .orderBy(desc(accounts.balance))
    .limit(25);
}

// ---------- wheel tabs ----------

export interface ActivityRow {
  id: number;
  at: Date;
  wedgeId: string;
  /** What the taker did. */
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  qty: number;
  /** Price per share in the taker's outcome, ticks. */
  price: number;
  name: string | null;
  slackId: string | null;
  /** The resting order's owner (who took the other side). */
  counterparty: string | null;
  counterpartyIsBot: boolean;
}

/** Recent fills on a wheel, from the taker's point of view (like Polymarket's Activity tab). */
export async function wheelActivity(wedgeIds: string[], limit = 30): Promise<ActivityRow[]> {
  if (!wedgeIds.length) return [];
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT t.id, t.created_at AS at, t.wedge_id, t.qty, l.outcome, l.shares, l.cash, u.name, u.slack_id,
           mu.name AS cp_name, COALESCE(mu.is_bot, false) AS cp_bot
    FROM trades t
    JOIN trade_legs l ON l.trade_id = t.id AND l.order_id = t.taker_order_id
    JOIN users u ON u.id = l.user_id
    LEFT JOIN trade_legs ml ON ml.trade_id = t.id AND ml.order_id = t.maker_order_id
    LEFT JOIN users mu ON mu.id = ml.user_id
    WHERE t.wedge_id IN (${idList(wedgeIds)})
    ORDER BY t.id DESC
    LIMIT ${limit}`)) as unknown as {
    rows: {
      id: number;
      at: Date;
      wedge_id: string;
      qty: number;
      outcome: "YES" | "NO";
      shares: number;
      cash: string | number;
      name: string | null;
      slack_id: string | null;
      cp_name: string | null;
      cp_bot: boolean;
    }[];
  };
  return r.rows.map((x) => ({
    id: Number(x.id),
    at: new Date(x.at),
    wedgeId: x.wedge_id,
    side: Number(x.shares) > 0 ? "BUY" : "SELL",
    outcome: x.outcome,
    qty: Number(x.qty),
    price: Math.round(Math.abs(Number(x.cash)) / Number(x.qty)),
    name: x.name,
    slackId: x.slack_id,
    counterparty: x.cp_name,
    counterpartyIsBot: x.cp_bot,
  }));
}

export async function topHolders(wedgeId: string, limit = 8) {
  const db = await getDb();
  const holder = (col: typeof positions.yesShares | typeof positions.noShares) =>
    db
      .select({ shares: col, name: users.name, slackId: users.slackId, isBot: users.isBot })
      .from(positions)
      .innerJoin(users, eq(users.id, positions.userId))
      .where(and(eq(positions.wedgeId, wedgeId), gt(col, 0)))
      .orderBy(desc(col))
      .limit(limit);
  const [yes, no] = await Promise.all([holder(positions.yesShares), holder(positions.noShares)]);
  return { yes, no };
}

// ---------- portfolio extras ----------

/** Average buy price per (wedge, outcome) for a user, from their fills. */
export async function costBasis(userId: string): Promise<Map<string, { bought: number; cost: number }>> {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT t.wedge_id, l.outcome, SUM(l.shares)::int AS bought, SUM(-l.cash)::text AS cost
    FROM trade_legs l JOIN trades t ON t.id = l.trade_id
    WHERE l.user_id = ${userId} AND l.shares > 0
    GROUP BY t.wedge_id, l.outcome`)) as unknown as { rows: { wedge_id: string; outcome: string; bought: number; cost: string }[] };
  return new Map(r.rows.map((x) => [`${x.wedge_id}:${x.outcome}`, { bought: Number(x.bought), cost: Number(x.cost) }]));
}

/**
 * Every settled wedge the user traded (won, lost or sold out before the end), with what the
 * settlement paid them and their net result: payout plus the cash their trades moved.
 */
export async function settledHistory(userId: string) {
  const db = await getDb();
  const r = (await db.execute(sql`
    WITH traded AS (
      SELECT t.wedge_id, SUM(l.cash) AS cash
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id
      WHERE l.user_id = ${userId}
      GROUP BY t.wedge_id
    ), paid AS (
      SELECT e.wedge_id, SUM(l.amount) AS amount
      FROM journal_entries e
      JOIN ledger_lines l ON l.entry_id = e.id
      JOIN accounts a ON a.id = l.account_id AND a.kind = 'user_available' AND a.user_id = ${userId}
      WHERE e.kind IN ('payout', 'moldy_refund')
      GROUP BY e.wedge_id
    )
    SELECT w.id AS wedge_id, w.label, w.status, wh.title, wh.slug, wh.category, wh.icon, wh.resolved_at,
           COALESCE(p.amount, 0)::text AS paid, COALESCE(tr.cash, 0)::text AS cash
    FROM wedges w
    JOIN wheels wh ON wh.id = w.wheel_id
    LEFT JOIN traded tr ON tr.wedge_id = w.id
    LEFT JOIN paid p ON p.wedge_id = w.id
    WHERE wh.status IN ('resolved', 'moldy') AND (tr.wedge_id IS NOT NULL OR p.wedge_id IS NOT NULL)
    ORDER BY wh.resolved_at DESC NULLS LAST, w.sort_order
    LIMIT 100`)) as unknown as {
    rows: {
      wedge_id: string;
      label: string;
      status: string;
      title: string;
      slug: string;
      category: string | null;
      icon: string | null;
      resolved_at: Date | null;
      paid: string;
      cash: string;
    }[];
  };
  return r.rows.map((x) => ({ ...x, paid: Number(x.paid), net: Number(x.paid) + Number(x.cash) }));
}

// ---------- site-wide activity & leaderboard ----------

export interface FeedRow extends ActivityRow {
  wedgeLabel: string;
  wheelTitle: string;
  wheelSlug: string;
  category: string | null;
  icon: string | null;
  binary: boolean;
}

/** Recent fills across every wheel, newest first, from the taker's point of view. */
export async function globalActivity(opts: { limit?: number; minTicks?: number } = {}): Promise<FeedRow[]> {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT t.id, t.created_at AS at, t.wedge_id, t.qty, l.outcome, l.shares, l.cash, u.name, u.slack_id,
           mu.name AS cp_name, COALESCE(mu.is_bot, false) AS cp_bot,
           w.label, wh.title, wh.slug, wh.category, wh.icon,
           (SELECT COUNT(*) FROM wedges x WHERE x.wheel_id = wh.id) = 1 AS binary
    FROM trades t
    JOIN trade_legs l ON l.trade_id = t.id AND l.order_id = t.taker_order_id
    JOIN users u ON u.id = l.user_id
    LEFT JOIN trade_legs ml ON ml.trade_id = t.id AND ml.order_id = t.maker_order_id
    LEFT JOIN users mu ON mu.id = ml.user_id
    JOIN wedges w ON w.id = t.wedge_id
    JOIN wheels wh ON wh.id = w.wheel_id
    WHERE ABS(l.cash) >= ${opts.minTicks ?? 0}
    ORDER BY t.id DESC
    LIMIT ${opts.limit ?? 60}`)) as unknown as {
    rows: {
      id: number;
      at: Date;
      wedge_id: string;
      qty: number;
      outcome: "YES" | "NO";
      shares: number;
      cash: string | number;
      name: string | null;
      slack_id: string | null;
      cp_name: string | null;
      cp_bot: boolean;
      label: string;
      title: string;
      slug: string;
      category: string | null;
      icon: string | null;
      binary: boolean;
    }[];
  };
  return r.rows.map((x) => ({
    id: Number(x.id),
    at: new Date(x.at),
    wedgeId: x.wedge_id,
    side: Number(x.shares) > 0 ? "BUY" : "SELL",
    outcome: x.outcome,
    qty: Number(x.qty),
    price: Math.round(Math.abs(Number(x.cash)) / Number(x.qty)),
    name: x.name,
    slackId: x.slack_id,
    counterparty: x.cp_name,
    counterpartyIsBot: x.cp_bot,
    wedgeLabel: x.label,
    wheelTitle: x.title,
    wheelSlug: x.slug,
    category: x.category,
    icon: x.icon,
    binary: x.binary,
  }));
}

export type LeaderPeriod = "day" | "week" | "month" | "all";
export type LeaderMetric = "profit" | "volume";

export interface LeaderRow {
  id: string;
  name: string | null;
  slackId: string | null;
  /** Realised profit (ticks): settlement payouts plus trade cash, on wheels settled in the period. */
  profit: number;
  /** Traded volume (ticks) in the period. */
  volume: number;
  cash: number;
}

const PERIOD_SQL: Record<LeaderPeriod, ReturnType<typeof sql>> = {
  day: sql`now() - interval '1 day'`,
  week: sql`now() - interval '7 days'`,
  month: sql`now() - interval '30 days'`,
  all: sql`'-infinity'::timestamptz`,
};

/** Hack Clubbers ranked by realised profit or by volume, over a period. Bots are left out. */
export async function leaderboardStats(metric: LeaderMetric, period: LeaderPeriod, limit = 50): Promise<LeaderRow[]> {
  const db = await getDb();
  const since = PERIOD_SQL[period];
  const r = (await db.execute(sql`
    WITH vol AS (
      SELECT l.user_id, SUM(ABS(l.cash)) AS v
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id
      WHERE t.created_at >= ${since}
      GROUP BY l.user_id
    ), settled AS (
      SELECT w.id FROM wedges w JOIN wheels wh ON wh.id = w.wheel_id
      WHERE wh.status IN ('resolved', 'moldy') AND wh.resolved_at >= ${since}
    ), cash AS (
      SELECT l.user_id, SUM(l.cash) AS c
      FROM trade_legs l JOIN trades t ON t.id = l.trade_id
      WHERE t.wedge_id IN (SELECT id FROM settled)
      GROUP BY l.user_id
    ), paid AS (
      SELECT a.user_id, SUM(ll.amount) AS p
      FROM journal_entries e
      JOIN ledger_lines ll ON ll.entry_id = e.id
      JOIN accounts a ON a.id = ll.account_id AND a.kind = 'user_available'
      WHERE e.kind IN ('payout', 'moldy_refund') AND e.wedge_id IN (SELECT id FROM settled)
      GROUP BY a.user_id
    )
    SELECT u.id, u.name, u.slack_id,
           (COALESCE(paid.p, 0) + COALESCE(cash.c, 0))::text AS profit,
           COALESCE(vol.v, 0)::text AS volume,
           COALESCE(acc.balance, 0)::text AS cash
    FROM users u
    LEFT JOIN vol ON vol.user_id = u.id
    LEFT JOIN cash ON cash.user_id = u.id
    LEFT JOIN paid ON paid.user_id = u.id
    LEFT JOIN accounts acc ON acc.user_id = u.id AND acc.kind = 'user_available'
    WHERE NOT u.is_bot AND (vol.v IS NOT NULL OR cash.c IS NOT NULL OR paid.p IS NOT NULL)
    ORDER BY ${metric === "profit" ? sql`(COALESCE(paid.p, 0) + COALESCE(cash.c, 0))` : sql`COALESCE(vol.v, 0)`} DESC
    LIMIT ${limit}`)) as unknown as {
    rows: { id: string; name: string | null; slack_id: string | null; profit: string; volume: string; cash: string }[];
  };
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    slackId: x.slack_id,
    profit: Number(x.profit),
    volume: Number(x.volume),
    cash: Number(x.cash),
  }));
}

/** Biggest single settled wins in a period: what a user put into one wheel and what they got back. */
export async function biggestWins(period: LeaderPeriod, limit = 8) {
  const db = await getDb();
  const since = PERIOD_SQL[period];
  const r = (await db.execute(sql`
    WITH per AS (
      SELECT x.user_id, x.wheel_id,
             SUM(CASE WHEN x.amount < 0 THEN -x.amount ELSE 0 END) AS spent,
             SUM(CASE WHEN x.amount > 0 THEN x.amount ELSE 0 END) AS got
      FROM (
        SELECT l.user_id, w.wheel_id, l.cash AS amount
        FROM trade_legs l JOIN trades t ON t.id = l.trade_id JOIN wedges w ON w.id = t.wedge_id
        UNION ALL
        SELECT a.user_id, w.wheel_id, ll.amount
        FROM journal_entries e
        JOIN ledger_lines ll ON ll.entry_id = e.id
        JOIN accounts a ON a.id = ll.account_id AND a.kind = 'user_available'
        JOIN wedges w ON w.id = e.wedge_id
        WHERE e.kind IN ('payout', 'moldy_refund')
      ) x GROUP BY x.user_id, x.wheel_id
    )
    SELECT u.name, u.slack_id, wh.title, wh.slug, wh.category, per.spent::text AS spent, per.got::text AS got
    FROM per
    JOIN users u ON u.id = per.user_id AND NOT u.is_bot
    JOIN wheels wh ON wh.id = per.wheel_id AND wh.status IN ('resolved', 'moldy') AND wh.resolved_at >= ${since}
    WHERE per.got > per.spent
    ORDER BY per.got - per.spent DESC
    LIMIT ${limit}`)) as unknown as {
    rows: { name: string | null; slack_id: string | null; title: string; slug: string; category: string | null; spent: string; got: string }[];
  };
  return r.rows.map((x) => ({ ...x, spent: Number(x.spent), got: Number(x.got), net: Number(x.got) - Number(x.spent) }));
}

/** The user's account value over time: cash (available + locked) after each ledger entry. */
export async function cashHistory(userId: string) {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT e.created_at AS at, SUM(SUM(l.amount)) OVER (ORDER BY e.created_at, e.id)::text AS bal
    FROM ledger_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id AND a.user_id = ${userId} AND a.kind IN ('user_available', 'user_locked')
    GROUP BY e.id, e.created_at
    ORDER BY e.created_at, e.id`)) as unknown as { rows: { at: Date; bal: string }[] };
  return r.rows.map((x) => ({ t: new Date(x.at).getTime(), v: Number(x.bal) }));
}

/** Headline numbers for a profile: traded volume, wheels traded, and when they joined. */
export async function userStats(userId: string) {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT COALESCE(SUM(ABS(l.cash)), 0)::text AS volume,
           COUNT(DISTINCT w.wheel_id)::int AS wheels,
           (SELECT created_at FROM users WHERE id = ${userId}) AS joined
    FROM trade_legs l JOIN trades t ON t.id = l.trade_id JOIN wedges w ON w.id = t.wedge_id
    WHERE l.user_id = ${userId}`)) as unknown as { rows: { volume: string; wheels: number; joined: Date | null }[] };
  const x = r.rows[0];
  return { volumeTicks: Number(x?.volume ?? 0), wheelsTraded: Number(x?.wheels ?? 0), joined: x?.joined ? new Date(x.joined) : null };
}

/** Value (ticks) of a user's open positions at today's chance. Same valuation as the portfolio page. */
export async function portfolioValue(userId: string): Promise<number> {
  const db = await getDb();
  const held = await db
    .select({ p: positions, wheelId: wedges.wheelId })
    .from(positions)
    .innerJoin(wedges, eq(wedges.id, positions.wedgeId))
    .where(
      and(
        eq(positions.userId, userId),
        inArray(wedges.status, ["open", "halted"]),
        or(gt(positions.yesShares, 0), gt(positions.noShares, 0)),
      ),
    );
  if (!held.length) return 0;
  const views = await wedgeViews([...new Set(held.map((h) => h.wheelId))]);
  const chanceById = new Map([...views.values()].flat().map((w) => [w.id, w.chance]));
  return held.reduce((s, h) => {
    const c = chanceById.get(h.p.wedgeId);
    return c == null ? s : s + h.p.yesShares * c + h.p.noShares * (100 - c);
  }, 0);
}

// ---------- The Mouse ----------

/** Today's chances as probabilities per LMSR outcome key ("YES"/"NO" for binary, wedge ids otherwise). */
export async function wheelChances(wheelId: string): Promise<Record<string, number>> {
  const ws = (await wedgeViews([wheelId])).get(wheelId) ?? [];
  if (ws.length === 1) {
    const c = ws[0]!.chance;
    return c == null ? {} : { YES: c / 100, NO: 1 - c / 100 };
  }
  if (ws.some((w) => w.chance == null)) return {};
  const total = ws.reduce((s, w) => s + Math.max(1, w.chance!), 0);
  return Object.fromEntries(ws.map((w) => [w.id, Math.max(1, w.chance!) / total]));
}

/** How The Mouse is doing: its cash, what's tied up in quotes, house backing, and coverage. */
export async function mouseStatus() {
  const db = await getDb();
  const r = (await db.execute(sql`
    WITH m AS (SELECT id FROM users WHERE bot_role = 'mouse')
    SELECT
      (SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE kind = 'user_available' AND user_id IN (SELECT id FROM m))::text AS available,
      (SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE kind = 'user_locked' AND user_id IN (SELECT id FROM m))::text AS locked,
      (SELECT COALESCE(-SUM(balance), 0) FROM accounts WHERE kind = 'house_issuance')::text AS house,
      (SELECT COUNT(*) FROM orders WHERE status = 'open' AND user_id IN (SELECT id FROM m))::int AS orders,
      (SELECT COUNT(*) FROM wheels WHERE status = 'open' AND liquidity > 0)::int AS wheels,
      (SELECT COUNT(*) FROM wheels WHERE status = 'open')::int AS open_wheels,
      (SELECT COALESCE(SUM(-l.amount), 0) FROM ledger_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE e.kind = 'churn' AND e.memo = 'fed the mouse' AND a.kind = 'churn_issuance')::text AS fed
  `)) as unknown as {
    rows: { available: string; locked: string; house: string; orders: number; wheels: number; open_wheels: number; fed: string }[];
  };
  const x = r.rows[0]!;
  return {
    availableTicks: Number(x.available),
    lockedTicks: Number(x.locked),
    houseTicks: Number(x.house),
    openOrders: Number(x.orders),
    quotingWheels: Number(x.wheels),
    openWheels: Number(x.open_wheels),
    fedTicks: Number(x.fed),
  };
}

// ---------- reports & watch ----------

/** Open reports (oldest first) with who sent them and what they point at. */
export async function openReports() {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId", r.reason, r.created_at AS "createdAt",
           rep.name AS "reporterName", rep.slack_id AS "reporterSlack",
           w.title AS "wheelTitle", w.slug AS "wheelSlug",
           tu.name AS "userName", tu.slack_id AS "userSlack"
    FROM reports r
    JOIN users rep ON rep.id = r.reporter_id
    LEFT JOIN wheels w ON r.target_type = 'wheel' AND w.id = r.target_id
    LEFT JOIN users tu ON r.target_type = 'user' AND tu.id = r.target_id
    WHERE r.status = 'open'
    ORDER BY r.created_at
    LIMIT 100
  `)) as unknown as {
    rows: {
      id: string; targetType: "wheel" | "user"; targetId: string; reason: string; createdAt: string | Date;
      reporterName: string | null; reporterSlack: string | null;
      wheelTitle: string | null; wheelSlug: string | null; userName: string | null; userSlack: string | null;
    }[];
  };
  return r.rows;
}

/** Pairs of people who keep trading with each other (possible wash trading), last 7 days. */
export async function watchPairs() {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT ua.id AS "aId", ua.name AS "aName", ub.id AS "bId", ub.name AS "bName",
           COUNT(DISTINCT t.id)::int AS trades, COALESCE(SUM(t.qty), 0)::int AS shares,
           COUNT(DISTINCT t.wedge_id)::int AS wedges
    FROM trade_legs a
    JOIN trade_legs b ON b.trade_id = a.trade_id AND a.user_id < b.user_id
    JOIN trades t ON t.id = a.trade_id
    JOIN users ua ON ua.id = a.user_id AND NOT ua.is_bot
    JOIN users ub ON ub.id = b.user_id AND NOT ub.is_bot
    WHERE t.created_at > now() - interval '7 days'
    GROUP BY ua.id, ua.name, ub.id, ub.name
    HAVING COUNT(DISTINCT t.id) >= 5
    ORDER BY trades DESC
    LIMIT 25
  `)) as unknown as { rows: { aId: string; aName: string | null; bId: string; bName: string | null; trades: number; shares: number; wedges: number }[] };
  return r.rows;
}

/** Big buys made shortly before a settlement was proposed (possible insider trading), last 30 days. */
export async function watchLateBuys() {
  const db = await getDb();
  const r = (await db.execute(sql`
    SELECT u.id AS "userId", u.name AS "userName", w.title AS "wheelTitle", w.slug AS "wheelSlug",
           s.created_at AS "proposedAt", COUNT(DISTINCT t.id)::int AS trades,
           SUM(l.shares)::int AS shares,
           MIN(EXTRACT(EPOCH FROM (s.created_at - t.created_at)) / 60)::int AS "minutesBefore"
    FROM settlements s
    JOIN wheels w ON w.id = s.wheel_id
    JOIN wedges wd ON wd.wheel_id = w.id
    JOIN trades t ON t.wedge_id = wd.id AND t.created_at BETWEEN s.created_at - interval '24 hours' AND s.created_at
    JOIN trade_legs l ON l.trade_id = t.id AND l.shares > 0
    JOIN users u ON u.id = l.user_id AND NOT u.is_bot
    WHERE s.status IN ('pending', 'approved') AND s.created_at > now() - interval '30 days'
    GROUP BY u.id, u.name, w.title, w.slug, s.created_at
    HAVING SUM(l.shares) >= 100
    ORDER BY SUM(l.shares) DESC
    LIMIT 25
  `)) as unknown as {
    rows: { userId: string; userName: string | null; wheelTitle: string; wheelSlug: string; proposedAt: string | Date; trades: number; shares: number; minutesBefore: number }[];
  };
  return r.rows;
}
