import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

// Secrets live in the repo-root .env.local, shared by every app. Variables already set
// in the environment (e.g. on Vercel) win, because loadEnvFile never overwrites.
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

const config: NextConfig = {
  transpilePackages: ["@cheddar/db", "@cheddar/engine", "@cheddar/exchange"],
  serverExternalPackages: ["@electric-sql/pglite", "pg", "embedded-postgres"],
  turbopack: { root },
  poweredByHeader: false,
  agentRules: false,
};

export default config;
