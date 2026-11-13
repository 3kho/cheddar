import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

/**
 * Default migrations location (works when run from source, e.g. tests).
 * Bundlers rewrite import.meta.url, so apps should pass their own path.
 */
export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** In-process Postgres for dev and tests. Pass a directory to persist, or nothing for in-memory. */
export async function createPgliteDb(dataDir?: string, opts: { migrationsFolder?: string } = {}) {
  if (dataDir && !dataDir.includes("://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: opts.migrationsFolder ?? migrationsFolder });
  return { db, client };
}

export type PgliteDb = Awaited<ReturnType<typeof createPgliteDb>>["db"];
