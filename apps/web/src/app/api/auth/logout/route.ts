import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { destroySession } from "@/lib/session";

// POST only, so a link or image on another site can't log people out.
export async function POST() {
  await destroySession();
  return NextResponse.redirect(new URL("/", env.appUrl), 303);
}
