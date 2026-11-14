import { NextResponse, type NextRequest } from "next/server";
import { fairPlayStep, linkHackatime } from "@/lib/accounts";
import { env } from "@/lib/env";
import { OAuthError, finishOAuth, getJson } from "@/lib/oauth";
import { currentUser } from "@/lib/session";

export async function GET(req: NextRequest) {
  const oops = (m: string) => NextResponse.redirect(new URL(`/oops?m=${encodeURIComponent(m)}`, env.appUrl));
  const user = await currentUser();
  if (!user) return oops("Please log in before linking Hackatime.");
  try {
    const t = await finishOAuth("hackatime", req.nextUrl);
    const me = await getJson("https://hackatime.hackclub.com/api/v1/authenticated/me", t.accessToken);
    const r = await linkHackatime(user.id, me, t);
    // The plain "link Hackatime" button lands on /portfolio with the churn result; from login we
    // carry on to the fair-play page (if not accepted yet) and then where they were headed.
    const dest = t.returnTo === "/portfolio" ? `/portfolio?churn=${r.status}&ticks=${r.creditedTicks}` : t.returnTo;
    return NextResponse.redirect(new URL(fairPlayStep(user.hasAcceptedFairPlay, dest), env.appUrl));
  } catch (e) {
    if (!(e instanceof OAuthError)) console.error(e);
    return oops(e instanceof OAuthError ? e.message : "Linking Hackatime failed. Please try again.");
  }
}
