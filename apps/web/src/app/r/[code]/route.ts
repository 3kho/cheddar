import { NextResponse, type NextRequest } from "next/server";
import { isReferralCode } from "@cheddar/exchange";
import { env, secureCookies } from "@/lib/env";
import { safeReturnTo } from "@/lib/oauth";
import { REFERRAL_COOKIE } from "@/lib/referral";

/**
 * Invite links. Remembers who invited this visitor for 30 days (until they sign in), then sends
 * them on to `?to=` (a wheel, say) or the home page. A bad code is ignored; the link still works.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code.toLowerCase();
  const res = NextResponse.redirect(new URL(safeReturnTo(req.nextUrl.searchParams.get("to")), env.appUrl));
  if (isReferralCode(code)) {
    res.cookies.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 3600,
    });
  }
  return res;
}
