import { NextResponse, type NextRequest } from "next/server";
import { beginOAuth } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const url = await beginOAuth("hca", req.nextUrl.searchParams.get("returnTo") ?? "/");
  return NextResponse.redirect(url);
}
