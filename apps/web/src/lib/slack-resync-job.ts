/* ------------------------------------------------------------------
 * slack-resync-job.ts
 *
 * Serverless‑friendly job that adds every active Cheddar user to the
 * Slack channel C0CH8NW4UNP and records who has left.
 * Meant to be called from a Vercel cron job (Authorization: Bearer $CRON_SECRET).
 ------------------------------------------------------------------ */

"use server";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users, slack_channel_members, slack_channel_left } from "@/db/src/schema";
import { sql } from "drizzle-orm";
import { WebClient } from "@slack/web-api";

// ---------- DB ----------
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pgPool);

// ---------- Slack ----------
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) {
  throw new Error("Missing SLACK_BOT_TOKEN env variable");
}
export const slack = new WebClient(slackToken);

// ---------- Constants ----------
export const CHANNEL_ID = "C0CH8NW4UNP";

// ---------- Helper: fetch current Slack members ----------
async function fetchCurrentMembers(): Promise<string[]> {
  const { ok, members } = await slack.conversations.members({
    channel: CHANNEL_ID,
  });
  if (ok && members) return members;
  console.error("Failed to fetch channel members:", ok ? undefined : (slack as any).error);
  return [];
}

// ---------- Helper: fetch all active app users ----------
async function fetchAppUsers(): Promise<string[]> {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.isBot} = false`);
  return result.map((r) => r.id.toString());
}

// ---------- Main job ----------
export async function runSlackResync() {
  console.log(`▶️  Starting slack resync at ${new Date().toISOString()}`);

  const slackMembers = await fetchCurrentMembers();
  const appUsers = await fetchAppUsers();

  // Who has ever been added
  const alreadyAddedRows = await db
    .select({ userId: slack_channel_members.userId })
    .from(slack_channel_members);
  const addedSet = new Set(alreadyAddedRows.map((r) => r.userId));

  // Detect who left
  const leftSet: Set<string> = new Set();
  const newlyLeft: { userId: string; leftAt: Date }[] = [];

  for (const userId of addedSet) {
    if (!slackMembers.includes(userId)) {
      leftSet.add(userId);
      newlyLeft.push({ userId, leftAt: new Date() });
    }
  }

  // Record left users (idempotent)
  if (newlyLeft.length) {
    await db
      .insert(slack_channel_left)
      .values(newlyLeft)
      .onConflictDoUpdate({
        targetIndex: ["userId"],
        set: { leftAt: new Date() },
      });
    console.log(`🛑 ${newlyLeft.length} user(s) have left the channel – recorded.`);
  }

  // Users to invite: app users not in channel and not marked as left
  const toAdd: string[] = appUsers.filter(
    (uid) => !slackMembers.includes(uid) && !leftSet.has(uid) && !addedSet.has(uid)
  );

  console.log(`👥 ${toAdd.length} user(s) will be invited to ${CHANNEL_ID}`);

  // Invite each user
  for (const uid of toAdd) {
    try {
      await slack.channels.invite({ channel: CHANNEL_ID, users: [uid] });
      await db.insert(slack_channel_members).values({ userId: uid }).onConflictDoNothing();
      console.log(`✅ Invited ${uid} to ${CHANNEL_ID}`);
    } catch (err) {
      console.error(`⚠️  Failed to invite ${uid}:`, (err as Error).message);
    }
  }

  // Remove from left table any users we just re‑added
  const toRemoveFromLeft = toAdd.filter((uid) => leftSet.has(uid));
  if (toRemoveFromLeft.length) {
    await db
      .delete(slack_channel_left)
      .where(sql`${slack_channel_left.userId} = any(${toRemoveFromLeft.map((u) => `\\''${u}\\''`::uuid)})`);
    console.log(`🧹 Removed ${toRemoveFromLeft.length} entry(s) from the “left” table.`);
  }

  console.log(`✅ Sync finished at ${new Date().toISOString()}\n`);
}