import "server-only";
import { eq, wedges } from "@cheddar/db";
import { mouseWheelIds, requoteWheel } from "@cheddar/exchange";
import { getDb, getExchange } from "./db";

type Globals = {
  cheddarMouseRuns?: Map<string, { running: Promise<void>; again: boolean }>;
  cheddarMouseTimer?: ReturnType<typeof setInterval>;
};
const g = globalThis as Globals;
const runs = (g.cheddarMouseRuns ??= new Map());

/**
 * Re-quote The Mouse on a wheel. Calls that arrive while one is running are folded into a single
 * follow-up run, so a burst of trades never queues a burst of re-quotes.
 */
export function requote(wheelId: string): Promise<void> {
  const cur = runs.get(wheelId);
  if (cur) {
    cur.again = true;
    return cur.running;
  }
  const entry = { running: Promise.resolve(), again: false };
  entry.running = (async () => {
    try {
      do {
        entry.again = false;
        const [db, ex] = await Promise.all([getDb(), getExchange()]);
        const r = await requoteWheel(db, ex, wheelId);
        // Its own quotes can trade with resting orders, which moves the other wedges' prices.
        if (r.trades > 0) entry.again = true;
      } while (entry.again);
    } catch (e) {
      console.error(`[mouse] requote of ${wheelId} failed`, e);
    } finally {
      runs.delete(wheelId);
    }
  })();
  runs.set(wheelId, entry);
  return entry.running;
}

export async function requoteForWedge(wedgeId: string): Promise<void> {
  const db = await getDb();
  const [w] = await db.select({ wheelId: wedges.wheelId }).from(wedges).where(eq(wedges.id, wedgeId));
  if (w) await requote(w.wheelId);
}

/** Re-quote every wheel The Mouse quotes on (or still has orders on). */
export async function requoteAll(): Promise<number> {
  const ids = await mouseWheelIds(await getDb());
  for (const id of ids) await requote(id);
  return ids.length;
}

/** Keeps quotes fresh even when nobody trades (e.g. after a pause or a rejected settlement). */
export function startMouseScheduler(): void {
  if (g.cheddarMouseTimer) return;
  const tick = () => void requoteAll().catch((e) => console.error("[mouse] run failed", e));
  g.cheddarMouseTimer = setInterval(tick, 60_000);
  g.cheddarMouseTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  console.log("[mouse] quoting every minute");
}
