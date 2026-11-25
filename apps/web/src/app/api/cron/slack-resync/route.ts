import { NextResponse } from "next/server";
import { runSlackResync } from "@/lib/slack-resync-job";

export async function GET(req: NextRequest) {
  try {
    await runSlackResync();
    return NextResponse.json({ ok: true, message: "Slack resync completed" });
  } catch (e) {
    console.error("slack-resync error:", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}