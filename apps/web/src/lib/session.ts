import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, mouseFunders, sessions, users } from "@cheddar/db";
import { getDb } from "./db";
import { randomToken, sha256 } from "./crypto";
import { secureCookies } from "./env";

const COOKIE = "cheddar_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  name: string | null;
  slackId: string | null;
  isCheesemonger: boolean;
  /** Runs users, Mouse funders, logs and health (/admin). Always a Cheesemonger too. */
  isSuperAdmin: boolean;
  hackatimeUserId: string | null;
  /** HC staff/adults whose Churn feeds The Mouse. They can look but not trade. */
  isMouseFunder: boolean;
  /** Suspended by a Cheesemonger: can look but not trade, propose or settle. */
  suspendReason: string | null;
  isSuspended: boolean;
}

/** Call from a route handler or server action. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const db = await getDb();
  await db.insert(sessions).values({ idHash: sha256(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.idHash, sha256(token)));
  }
  jar.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      slackId: users.slackId,
      isCheesemonger: users.isCheesemonger,
      isSuperAdmin: users.isSuperAdmin,
      hackatimeUserId: users.hackatimeUserId,
      suspendedAt: users.suspendedAt,
      suspendReason: users.suspendReason,
      funder: mouseFunders.slackId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(mouseFunders, and(eq(mouseFunders.slackId, users.slackId), eq(mouseFunders.active, true)))
    .where(and(eq(sessions.idHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const { funder, suspendedAt, ...u } = row;
  return { ...u, isMouseFunder: !!funder, isSuspended: !!suspendedAt };
});

export async function requireUser(returnTo = "/"): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return u;
}

export async function requireCheesemonger(): Promise<SessionUser> {
  const u = await requireUser("/cheesemongers");
  if (!u.isCheesemonger) redirect("/");
  return u;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const u = await requireUser("/admin");
  if (!u.isSuperAdmin) redirect("/");
  return u;
}
