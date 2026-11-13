import { NextResponse, type NextRequest } from "next/server";
import { runChurn } from "@/lib/churn-job";
import { cronAuthorized } from "@/lib/cron-auth";

export const maxDuration = 300;

/**
 * Churn for everyone, for hosts without a long-running process (e.g. Vercel Cron).
 * Call with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runChurn("cron"));
}
