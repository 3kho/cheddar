import { NextResponse, type NextRequest } from "next/server";
import { runSlackResync } from "@/lib/slack-resync-job";
import { cronAuthorized } from "@/lib/cron-auth";

export const maxDuration = 300;

/**
 * Vercel Cron job that triggers the Slack resync.
 * Call with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await runSlackResync();
    return NextResponse.json({ ok: true, message: "Slack resync completed" });
  } catch (e) {
    console.error("Slack resync cron error:", e);
    return NextResponse.json(
      { error: "internal server error", details: (e as Error).message },
      { status: 500 }
    );
  }
}