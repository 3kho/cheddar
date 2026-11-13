import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "./env";

/** True when the request carries `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it). */
export function cronAuthorized(req: NextRequest): boolean {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.cronSecret}`);
  return !!env.cronSecret && given.length === want.length && timingSafeEqual(given, want);
}
