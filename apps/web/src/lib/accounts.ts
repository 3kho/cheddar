import "server-only";
import { cache } from "react";
import { and, desc, eq, isNull, sql, churnSyncs, mouseFunders, oauthTokens, users } from "@cheddar/db";
import { CHURN_NOT_FOUND, CHURN_PRIVATE, syncUser, type ChurnResult } from "@cheddar/exchange";
import { decrypt, encrypt } from "./crypto";
import { getDb, getHackatime } from "./db";
import { env } from "./env";
import { OAuthError } from "./oauth";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `base`, or `base 2`, `base 3`... if another account already has it (names are unique, ignoring case). */
async function freeName(db: Awaited<ReturnType<typeof getDb>>, base: string | null): Promise<string | null> {
  if (!base) return null;
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    const [hit] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.name}) = lower(${candidate})`).limit(1);
    if (!hit) return candidate;
  }
  return `${base} ${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Where to send someone right after they sign in with Hack Club Auth: the "How it works" tour if
 * they haven't seen it, then the fair-play page if they haven't accepted it, then wherever they
 * were headed. Nobody has to link Hackatime: their hours are looked up by their Slack id (linking
 * is only a fallback, see hackatimeStatus).
 */
export async function nextStepAfterLogin(userId: string, returnTo: string): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .select({ fairPlay: users.fairPlayAcceptedAt, tour: users.tourSeenAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!u?.tour) return `/how-it-works?returnTo=${encodeURIComponent(returnTo)}`;
  return fairPlayStep(!!u?.fairPlay, returnTo);
}

/**
 * Can we read this person's Hackatime hours?
 *  - linked:    they linked a Hackatime account (we use that, with their token if stats are private)
 *  - ok:        looked up by Slack id and it worked
 *  - private:   their Hackatime stats are private, so we can't see their hours
 *  - not_found: Hackatime has no coding for their Slack id yet
 *  - no_slack:  no Slack id on their Hack Club account, so the only way is to link Hackatime
 *  - unknown:   not checked yet (it happens within minutes of signing in)
 */
export type HackatimeStatus = "linked" | "ok" | "private" | "not_found" | "no_slack" | "unknown";

export const hackatimeStatus = cache(
  async (u: { id: string; slackId: string | null; hackatimeUserId: string | null }): Promise<HackatimeStatus> => {
    if (u.hackatimeUserId) return "linked";
    if (!u.slackId) return "no_slack";
    const db = await getDb();
    const [last] = await db
      .select({ status: churnSyncs.status, error: churnSyncs.error })
      .from(churnSyncs)
      .where(eq(churnSyncs.userId, u.id))
      .orderBy(desc(churnSyncs.id))
      .limit(1);
    if (!last) return "unknown";
    if (last.status === "error") {
      if (last.error?.startsWith(CHURN_PRIVATE)) return "private";
      if (last.error?.startsWith(CHURN_NOT_FOUND)) return "not_found";
      return "unknown"; // Hackatime was down, or similar: nothing for them to fix
    }
    return "ok";
  },
);

/** The fair-play page if they haven't accepted yet, otherwise on to `returnTo`. */
export function fairPlayStep(accepted: boolean, returnTo: string): string {
  return accepted ? returnTo : `/welcome?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Create or update the Cheddar user for a Hack Club Auth identity. */
export async function upsertHcaUser(claims: Record<string, unknown>): Promise<string> {
  const sub = str(claims.sub);
  if (!sub) throw new OAuthError("Hack Club Auth did not return an account id.");
  const slackId = str(claims.slack_id)?.toUpperCase() ?? null;
  // The HCA name only seeds a brand-new account. Once someone has a name (they can change it on
  // /profile) logging in never overwrites it.
  const hcaName = str(claims.nickname) ?? str(claims.name);
  const profile = {
    email: str(claims.email),
    slackId,
    verificationStatus: str(claims.verification_status),
  };
  const superAdmin = !!slackId && env.superAdminSlackIds.includes(slackId);
  const promote = superAdmin || (!!slackId && env.cheesemongerSlackIds.includes(slackId));
  const roles = { ...(promote ? { isCheesemonger: true } : {}), ...(superAdmin ? { isSuperAdmin: true } : {}) };
  const db = await getDb();
  const seedName = await freeName(db, hcaName);

  // First login of someone a Cheesemonger added as a Mouse funder before they signed up:
  // take over that placeholder so their Churn history (and The Mouse's credit) carries over.
  if (slackId) {
    const [known] = await db.select({ id: users.id }).from(users).where(eq(users.hcaSub, sub));
    if (!known) {
      const [claimed] = await db
        .update(users)
        .set({ hcaSub: sub, ...profile, name: sql`coalesce(${users.name}, ${seedName}::text)`, ...roles })
        .where(and(eq(users.slackId, slackId), isNull(users.hcaSub), eq(users.isBot, false)))
        .returning({ id: users.id });
      if (claimed) return claimed.id;
    }
  }

  const [row] = await db
    .insert(users)
    .values({ hcaSub: sub, ...profile, name: seedName, isCheesemonger: promote, isSuperAdmin: superAdmin })
    .onConflictDoUpdate({
      target: users.hcaSub,
      set: { ...profile, ...roles },
    })
    .returning({ id: users.id });
  return row!.id;
}

/** Attach a Hackatime account (from its OAuth /me) to a Cheddar user, then pay their Churn. */
export async function linkHackatime(
  userId: string,
  me: Record<string, unknown>,
  token: { accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string },
): Promise<ChurnResult> {
  const hackatimeUserId = typeof me.id === "number" || typeof me.id === "string" ? String(me.id) : null;
  if (!hackatimeUserId || !/^\d+$/.test(hackatimeUserId)) throw new OAuthError("Hackatime did not return an account id.");
  const htSlack = str(me.slack_id)?.toUpperCase() ?? null;

  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new OAuthError("Please log in again.");
  if (u.slackId && htSlack && u.slackId !== htSlack) {
    throw new OAuthError("That Hackatime account belongs to a different Slack user than your Hack Club account.");
  }
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.hackatimeUserId, hackatimeUserId));
  if (taken && taken.id !== userId) {
    throw new OAuthError("That Hackatime account is already linked to another Cheddar account.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ hackatimeUserId, hackatimeLinkedAt: new Date() })
      .where(eq(users.id, userId));
    const values = {
      accessTokenEnc: encrypt(token.accessToken),
      refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : null,
      expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null,
      scope: token.scope ?? null,
      updatedAt: new Date(),
    };
    await tx
      .insert(oauthTokens)
      .values({ userId, provider: "hackatime", ...values })
      .onConflictDoUpdate({ target: [oauthTokens.userId, oauthTokens.provider], set: values });
  });
  return syncUser(db, getHackatime(), userId, { tokenFor: hackatimeToken });
}

/** The user's Hackatime OAuth token, for users whose stats are private. */
export async function hackatimeToken(userId: string): Promise<string | undefined> {
  const db = await getDb();
  const [t] = await db
    .select({ enc: oauthTokens.accessTokenEnc })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "hackatime")));
  if (!t) return undefined;
  try {
    return decrypt(t.enc);
  } catch {
    return undefined;
  }
}

export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

/** User-triggered sync, at most once per cooldown. */
export async function syncNow(userId: string): Promise<ChurnResult | { status: "cooldown"; retryAt: Date }> {
  const db = await getDb();
  const [last] = await db
    .select({ at: churnSyncs.fetchedAt })
    .from(churnSyncs)
    .where(eq(churnSyncs.userId, userId))
    .orderBy(desc(churnSyncs.fetchedAt))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < SYNC_COOLDOWN_MS) {
    return { status: "cooldown", retryAt: new Date(last.at.getTime() + SYNC_COOLDOWN_MS) };
  }
  return syncUser(db, getHackatime(), userId, { tokenFor: hackatimeToken });
}
