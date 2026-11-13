import { NextResponse, type NextRequest } from "next/server";
import { upsertHcaUser } from "@/lib/accounts";
import { env } from "@/lib/env";
import { OAuthError, finishOAuth, getJson } from "@/lib/oauth";
import { createSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const t = await finishOAuth("hca", req.nextUrl);
    const claims = await getJson("https://auth.hackclub.com/oauth/userinfo", t.accessToken);
    const userId = await upsertHcaUser(claims);
    await createSession(userId);
    return NextResponse.redirect(new URL(t.returnTo, env.appUrl));
  } catch (e) {
    const message = e instanceof OAuthError ? e.message : "Login failed. Please try again.";
    if (!(e instanceof OAuthError)) console.error(e);
    return NextResponse.redirect(new URL(`/oops?m=${encodeURIComponent(message)}`, env.appUrl));
  }
}
