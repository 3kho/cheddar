import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schemaNs from "./schema";

// Re-export the query builder so every package uses this package's single drizzle-orm copy.
export { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
export * as schema from "./schema";
export * from "./schema";
export { createPgliteDb, migrationsFolder, type PgliteDb } from "./client";
export { createNodePgDb } from "./pg";

/** Any Cheddar database handle (PGlite or node-postgres). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schemaNs, any>;
/** A transaction handle on an AnyDb. */
export type Tx = Parameters<Parameters<AnyDb["transaction"]>[0]>[0];
