import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrationsFolder as defaultMigrations } from "./client";
import * as schema from "./schema";

/** Real Postgres via node-postgres. Runs migrations unless `migrate: false`. */
export async function createNodePgDb(
  connectionString: string,
  opts: { max?: number; migrate?: boolean; migrationsFolder?: string } = {},
) {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = drizzle({ client: pool, schema });
  if (opts.migrate !== false) await migrate(db, { migrationsFolder: opts.migrationsFolder ?? defaultMigrations });
  return { db, pool };
}
