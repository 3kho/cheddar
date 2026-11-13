import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrationsFolder as defaultMigrations } from "./client";
import * as schema from "./schema";

/**
 * node-postgres already treats sslmode=require/prefer/verify-ca as verify-full and warns about it
 * on every connection. Say verify-full explicitly: same behaviour, no warning.
 */
function normalizeSsl(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get("sslmode");
    if (mode && ["require", "prefer", "verify-ca"].includes(mode) && !u.searchParams.has("uselibpqcompat")) {
      u.searchParams.set("sslmode", "verify-full");
    }
    return u.toString();
  } catch {
    return connectionString;
  }
}

/** Real Postgres via node-postgres. Runs migrations unless `migrate: false`. */
export async function createNodePgDb(
  connectionString: string,
  opts: { max?: number; migrate?: boolean; migrationsFolder?: string } = {},
) {
  const pool = new pg.Pool({
    connectionString: normalizeSsl(connectionString),
    max: opts.max ?? 10,
    // Hosted Postgres (Neon etc.) drops idle connections; close ours first and fail fast
    // instead of hanging a request when the database is waking up.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  // Without a listener, an idle client dropped by the server emits an unhandled 'error' that
  // kills the whole process. The pool already discards that client; just log it.
  pool.on("error", (e) => console.error("[db] idle client error", e.message));
  const db = drizzle({ client: pool, schema });
  if (opts.migrate !== false) await migrate(db, { migrationsFolder: opts.migrationsFolder ?? defaultMigrations });
  return { db, pool };
}
