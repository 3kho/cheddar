import { NextResponse, type NextRequest } from "next/server";
import { upsertHcaUser } from "@/lib/accounts";
import { env } from "@/lib/env";
import { OAuthError, finishOAuth, getJson } from "@/lib/oauth";
import { eq, users } from "@cheddar/db";
import { getDb } from "@/lib/db";
import { createSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const t = await finishOAuth("hca", req.nextUrl);
    const claims = await getJson("https://auth.hackclub.com/oauth/userinfo", t.accessToken);
    const userId = await upsertHcaUser(claims);
    await createSession(userId);
    // Anyone who hasn't ticked the fair-play rules yet goes through that page first.
    const [row] = await (await getDb()).select({ at: users.fairPlayAcceptedAt }).from(users).where(eq(users.id, userId));
    const next = row?.at ? t.returnTo : `/welcome?returnTo=${encodeURIComponent(t.returnTo)}`;
    return NextResponse.redirect(new URL(next, env.appUrl));
  } catch (e) {
    const message = e instanceof OAuthError ? e.message : "Login failed. Please try again.";
    if (!(e instanceof OAuthError)) console.error(e);
    return NextResponse.redirect(new URL(`/oops?m=${encodeURIComponent(message)}`, env.appUrl));
  }
}
