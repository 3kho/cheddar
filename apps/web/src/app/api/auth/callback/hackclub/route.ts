import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { attachReferral } from "@cheddar/exchange";
import { getDb } from "@/lib/db";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { nextStepAfterLogin, upsertHcaUser } from "@/lib/accounts";
import { env } from "@/lib/env";
import { OAuthError, finishOAuth, getJson } from "@/lib/oauth";
import { createSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const t = await finishOAuth("hca", req.nextUrl);
    const claims = await getJson("https://auth.hackclub.com/oauth/userinfo", t.accessToken);
    const userId = await upsertHcaUser(claims);
    await createSession(userId);
    // Signed up through someone's invite link? Remember who invited them (a bad link never blocks login).
    const jar = await cookies();
    const invite = jar.get(REFERRAL_COOKIE)?.value;
    if (invite) {
      try {
        await attachReferral(await getDb(), { refereeId: userId, code: invite });
      } catch (e) {
        console.error(e);
      }
      jar.delete(REFERRAL_COOKIE);
    }
    return NextResponse.redirect(new URL(await nextStepAfterLogin(userId, t.returnTo), env.appUrl));
  } catch (e) {
    const message = e instanceof OAuthError ? e.message : "Login failed. Please try again.";
    if (!(e instanceof OAuthError)) console.error(e);
    return NextResponse.redirect(new URL(`/oops?m=${encodeURIComponent(message)}`, env.appUrl));
  }
}
