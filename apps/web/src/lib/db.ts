import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { and, createNodePgDb, createPgliteDb, eq, inArray, users, type AnyDb } from "@cheddar/db";
import { Exchange, HackatimeHttpClient } from "@cheddar/exchange";
import { env } from "./env";

/** Repo root: the web app runs from apps/web. Override with CHEDDAR_ROOT when deployed elsewhere. */
const root = process.env.CHEDDAR_ROOT ?? path.resolve(process.cwd(), "../..");
const migrationsFolder =
  [path.join(root, "packages", "db", "drizzle"), path.resolve(process.cwd(), "packages", "db", "drizzle")].find((p) =>
    existsSync(path.join(p, "meta", "_journal.json")),
  ) ?? path.join(root, "packages", "db", "drizzle");

type Globals = { cheddarDb?: Promise<AnyDb>; cheddarExchange?: Exchange; cheddarHackatime?: HackatimeHttpClient };
const g = globalThis as Globals;

async function open(): Promise<AnyDb> {
  let db: AnyDb;
  if (env.databaseUrl) {
    // Serverless: many short-lived instances, so keep each pool small. Migrations run at build
    // time there (scripts/migrate.ts), not on every cold start.
    const opts = env.onVercel ? { max: 5, migrate: false } : { migrationsFolder };
    db = (await createNodePgDb(env.databaseUrl, opts)).db as unknown as AnyDb;
  } else if (env.onVercel) {
    throw new Error("DATABASE_URL is required on Vercel (there is no persistent disk for PGlite).");
  } else {
    // No DATABASE_URL: a local PGlite database in <repo>/.data/pglite.
    db = (await createPgliteDb(path.join(root, ".data", "pglite"), { migrationsFolder })).db as unknown as AnyDb;
  }
  // Promote everyone on CHEDDAR_CHEESEMONGER_SLACK_IDS, including people already signed up.
  // (Promotion only: removing someone from the list doesn't demote them.)
  if (env.cheesemongerSlackIds.length) {
    await db
      .update(users)
      .set({ isCheesemonger: true })
      .where(and(inArray(users.slackId, env.cheesemongerSlackIds), eq(users.isCheesemonger, false)));
  }
  if (env.superAdminSlackIds.length) {
    await db
      .update(users)
      .set({ isSuperAdmin: true, isCheesemonger: true })
      .where(and(inArray(users.slackId, env.superAdminSlackIds), eq(users.isSuperAdmin, false)));
  }
  return db;
}

export function getDb(): Promise<AnyDb> {
  return (g.cheddarDb ??= open().catch((e) => {
    g.cheddarDb = undefined;
    throw e;
  }));
}

/**
 * The order service. Safe to have one per server process (or per serverless instance):
 * each Wedge's book_version check reloads a stale in-memory book from the database.
 */
export async function getExchange(): Promise<Exchange> {
  const db = await getDb();
  return (g.cheddarExchange ??= new Exchange(db));
}

export function getHackatime(): HackatimeHttpClient {
  return (g.cheddarHackatime ??= new HackatimeHttpClient());
}
