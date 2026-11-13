/** Apply database migrations to DATABASE_URL. Runs during the Vercel build. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodePgDb } from "@cheddar/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set, skipping");
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { pool } = await createNodePgDb(url, { max: 1, migrationsFolder: path.join(root, "packages", "db", "drizzle") });
  await pool.end();
  console.log("[migrate] done");
}
