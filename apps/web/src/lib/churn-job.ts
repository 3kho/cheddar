import "server-only";
import { logEvent, syncAll } from "@cheddar/exchange";
import { hackatimeToken } from "./accounts";
import { getDb, getHackatime } from "./db";

export interface ChurnRunSummary {
  source: "scheduler" | "cron";
  users: number;
  creditedTicks: number;
  counts: Record<string, number>;
  ms: number;
}

/** Sync every linked user once. Logged to the audit log when it paid anything or hit errors. */
export async function runChurn(source: ChurnRunSummary["source"]): Promise<ChurnRunSummary> {
  const started = Date.now();
  const db = await getDb();
  const results = await syncAll(db, getHackatime(), { tokenFor: hackatimeToken, concurrency: 4 });
  const counts: Record<string, number> = {};
  let creditedTicks = 0;
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    creditedTicks += r.creditedTicks;
  }
  const summary = { source, users: results.length, creditedTicks, counts, ms: Date.now() - started };
  if (creditedTicks > 0 || counts.error) {
    await logEvent(db, { actorId: null, action: "churn.run", details: { ...summary } });
  }
  return summary;
}

type Globals = { cheddarChurnTimer?: ReturnType<typeof setInterval> };

/**
 * In-process scheduler for long-running servers (local dev, Nest, any VM).
 * Set CHURN_INTERVAL_MINUTES=0 on serverless hosts (Vercel) and use /api/cron/churn instead.
 * Safe with several server processes: each sync is idempotent and locked per user.
 */
export function startChurnScheduler(): void {
  const g = globalThis as Globals;
  if (g.cheddarChurnTimer) return;
  const minutes = Number(process.env.CHURN_INTERVAL_MINUTES ?? "15");
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[churn] in-process scheduler disabled (CHURN_INTERVAL_MINUTES=0)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      const s = await runChurn("scheduler");
      if (s.users) console.log(`[churn] ${s.users} users, +${s.creditedTicks} ticks, ${JSON.stringify(s.counts)} in ${s.ms}ms`);
    } catch (e) {
      console.error("[churn] run failed", e);
    } finally {
      running = false;
    }
  };
  g.cheddarChurnTimer = setInterval(tick, minutes * 60_000);
  g.cheddarChurnTimer.unref?.();
  setTimeout(tick, 15_000).unref?.(); // first run shortly after boot
  console.log(`[churn] syncing every ${minutes} min`);
}
