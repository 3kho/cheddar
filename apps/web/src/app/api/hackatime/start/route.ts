import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { beginOAuth } from "@/lib/oauth";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!(await currentUser())) {
    return NextResponse.redirect(new URL("/api/auth/login?returnTo=/portfolio", env.appUrl));
  }
  return NextResponse.redirect(await beginOAuth("hackatime", "/portfolio"));
}
