/**
 * Simple per-user rate limits, backed by the database (so they work on serverless, with no Redis).
 * Each allowed action leaves a row in rate_events; a limit is "at most N rows in the last W seconds".
 */
import { and, eq, gt, lt, rateEvents, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError } from "./errors";

export interface RateRule {
  /** What's being limited, e.g. "order". */
  key: string;
  limit: number;
  windowSeconds: number;
  /** How to describe it in the error: "place orders", "send proposals". */
  what: string;
}

export const RATES = {
  order: { key: "order", limit: 40, windowSeconds: 60, what: "place orders" },
  proposal: { key: "proposal", limit: 5, windowSeconds: 24 * 3600, what: "propose wheels" },
  outcomeRequest: { key: "outcome_request", limit: 10, windowSeconds: 3600, what: "suggest outcomes" },
  report: { key: "report", limit: 5, windowSeconds: 24 * 3600, what: "send reports" },
  rename: { key: "rename", limit: 3, windowSeconds: 24 * 3600, what: "change your name" },
} satisfies Record<string, RateRule>;

/** "12 seconds", "3 minutes", "2 hours". */
export function humanWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/**
 * Count this action against `rule`, or throw a friendly RATE_LIMITED error saying when to retry.
 * Call it just before doing the action (the event is recorded only when allowed).
 */
export async function takeRate(db: AnyDb | Tx, userId: string, rule: RateRule, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - rule.windowSeconds * 1000);
  const recent = await db
    .select({ at: rateEvents.at })
    .from(rateEvents)
    .where(and(eq(rateEvents.userId, userId), eq(rateEvents.key, rule.key), gt(rateEvents.at, since)))
    .orderBy(rateEvents.at)
    .limit(rule.limit);
  if (recent.length >= rule.limit) {
    // The oldest event in the window expires first; that's when a slot frees up.
    const wait = (recent[0]!.at.getTime() + rule.windowSeconds * 1000 - now.getTime()) / 1000;
    const per = rule.windowSeconds >= 3600 ? (rule.windowSeconds >= 86_400 ? "day" : "hour") : "minute";
    throw new ExchangeError(
      "RATE_LIMITED",
      `Slow down: you can only ${rule.what} ${rule.limit} times per ${per}. Try again in ${humanWait(wait)}.`,
    );
  }
  await db.insert(rateEvents).values({ userId, key: rule.key, at: now });
  // Keep the table small: occasionally drop events nobody can still be limited by.
  if (Math.random() < 0.02) {
    await db.delete(rateEvents).where(lt(rateEvents.at, new Date(now.getTime() - 2 * 86_400_000)));
  }
}
