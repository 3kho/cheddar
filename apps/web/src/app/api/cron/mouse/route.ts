import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { requoteAll } from "@/lib/mouse-job";

export const maxDuration = 300;

/**
 * Refresh The Mouse's quotes on every wheel, for hosts without a long-running process.
 * Trades already re-quote straight away; this catches pauses, rejected settlements, etc.
 * Call with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const wheels = await requoteAll();
  return NextResponse.json({ wheels, ms: Date.now() - started });
}
