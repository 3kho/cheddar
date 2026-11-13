import "server-only";
import { and, desc, eq, isNull, churnSyncs, oauthTokens, users } from "@cheddar/db";
import { syncUser, type ChurnResult } from "@cheddar/exchange";
import { decrypt, encrypt } from "./crypto";
import { getDb, getHackatime } from "./db";
import { env } from "./env";
import { OAuthError } from "./oauth";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Create or update the Cheddar user for a Hack Club Auth identity. */
export async function upsertHcaUser(claims: Record<string, unknown>): Promise<string> {
  const sub = str(claims.sub);
  if (!sub) throw new OAuthError("Hack Club Auth did not return an account id.");
  const slackId = str(claims.slack_id)?.toUpperCase() ?? null;
  const profile = {
    name: str(claims.nickname) ?? str(claims.name),
    email: str(claims.email),
    slackId,
    verificationStatus: str(claims.verification_status),
  };
  const promote = !!slackId && env.cheesemongerSlackIds.includes(slackId);
  const db = await getDb();

  // First login of someone a Cheesemonger added as a Mouse funder before they signed up:
  // take over that placeholder so their Churn history (and The Mouse's credit) carries over.
  if (slackId) {
    const [known] = await db.select({ id: users.id }).from(users).where(eq(users.hcaSub, sub));
    if (!known) {
      const [claimed] = await db
        .update(users)
        .set({ hcaSub: sub, ...profile, ...(promote ? { isCheesemonger: true } : {}) })
        .where(and(eq(users.slackId, slackId), isNull(users.hcaSub), eq(users.isBot, false)))
        .returning({ id: users.id });
      if (claimed) return claimed.id;
    }
  }

  const [row] = await db
    .insert(users)
    .values({ hcaSub: sub, ...profile, isCheesemonger: promote })
    .onConflictDoUpdate({
      target: users.hcaSub,
      set: { ...profile, ...(promote ? { isCheesemonger: true } : {}) },
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
