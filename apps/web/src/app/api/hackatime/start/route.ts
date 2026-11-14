import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { beginOAuth, safeReturnTo } from "@/lib/oauth";
import { currentUser } from "@/lib/session";

export async function GET(req: NextRequest) {
  // `returnTo` is where to land once linked (login sends people on to where they were headed).
  const returnTo = req.nextUrl.searchParams.has("returnTo") ? safeReturnTo(req.nextUrl.searchParams.get("returnTo")) : "/portfolio";
  if (!(await currentUser())) {
    return NextResponse.redirect(new URL(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, env.appUrl));
  }
  return NextResponse.redirect(await beginOAuth("hackatime", returnTo));
}
