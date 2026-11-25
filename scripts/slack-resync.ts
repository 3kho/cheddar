/* ------------------------------------------------------------------
 * slack-resync.ts
 *
 * – Runs every 10 minutes (you can hook it to cron, systemd timer, etc.)
 * – Adds every active app user to the Slack channel C0CH8NW4UNP
 * – Remembers who has ever been added, and skips anyone who has left.
 ------------------------------------------------------------------ */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  users,
  slack_channel_members,
  slack_channel_left,
} from "../packages/db/src/schema"; // adjust the import path to your schema
import { WebClient } from "@slack/web-api";
import { sql } from "drizzle-orm";

// ---------------------------------------------------
// 1️⃣  DB connection
// ---------------------------------------------------
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgresql://...,
});
const db = drizzle(pgPool);

// ---------------------------------------------------
// 2️⃣  Slack Web client
// ---------------------------------------------------
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) {
  console.error("❌ Missing SLACK_BOT_TOKEN environment variable");
  process.exit(1);
}
const slack = new WebClient(slackToken);

// ---------------------------------------------------
// 3️⃣  Constants
// ---------------------------------------------------
const CHANNEL_ID = "C0CH8NW4UNP"; // the target channel

// ---------------------------------------------------
// 4️⃣  Helper: get current members of the channel
// ---------------------------------------------------
async function fetchCurrentMembers(): Promise<string[]> {
  const result = await slack.conversations.members({
    channel: CHANNEL_ID,
  });
  if (result.ok && result.members) {
    return result.members; // array of Slack user IDs (strings)
  }
  console.error("❌ Failed to fetch channel members:", result.error);
  return [];
}

// ---------------------------------------------------
// 5️⃣  Helper: get all app users (including bots)
// ---------------------------------------------------
async function fetchAppUsers(): Promise<string[]> {
  const result = await db
    .select({ id: users.id })
    .from(users);
  return result.map((r) => r.id.toString());
}

// ---------------------------------------------------
// 6️⃣  Core sync logic
// ---------------------------------------------------
async function runSync() {
  console.log(`▶️  Starting slack resync at ${new Date().toISOString()}`);

  // 6.1  Current Slack members
  const slackMembers = await fetchCurrentMembers();

  // 6.2  All active app users (internal UUIDs → string)
  const appUsers = await fetchAppUsers();

  // 6.3  Who is already tracked as “ever‑added” ?
  const alreadyAddedRows = await db
    .select({ userId: slack_channel_members.userId })
    .from(slack_channel_members);
  const addedSet = new Set(alreadyAddedRows.map((r) => r.userId));

  // 6.4  Detect who has left the channel (present in addedSet but not now in Slack)
  const leftSet: Set<string> = new Set();
  const newlyLeft: { userId: string; leftAt: Date }[] = [];

  for (const userId of addedSet) {
    if (!slackMembers.includes(userId)) {
      leftSet.add(userId);
      newlyLeft.push({ userId, leftAt: new Date() });
    }
  }

  // 6.5  Record left users (idempotent)
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

  // 6.6  Users to invite: app users NOT in the channel AND not marked as left
  const toAdd: string[] = appUsers.filter(
    (uid) => !slackMembers.includes(uid) && !leftSet.has(uid) && !addedSet.has(uid)
  );

  console.log(`👥 ${toAdd.length} user(s) will be invited to ${CHANNEL_ID}`);

  // 6.7  Invite each user
  for (const uid of toAdd) {
    try {
      await slack.channels.invite({ channel: CHANNEL_ID, users: [uid] });
      // Record that we just added them
      await db.insert(slack_channel_members).values({ userId: uid }).onConflictDoNothing();
      console.log(`✅ Invited ${uid} to ${CHANNEL_ID}`);
    } catch (err) {
      console.error(`⚠️  Failed to invite ${uid}:`, (err as Error).message);
    }
  }

  // 6.8  Remove from the “left” table any users we just re‑added
  const toRemoveFromLeft = toAdd.filter((uid) => leftSet.has(uid));
  if (toRemoveFromLeft.length) {
    await db
      .delete(slack_channel_left)
      .where(sql`${slack_channel_left.userId} = any(${toRemoveFromLeft.map((u) => `\\''${u}\\''`::uuid)})`);
    console.log(`🧹 Removed ${toRemoveFromLeft.length} entry(s) from the “left” table.`);
  }

  console.log(`✅ Sync finished at ${new Date().toISOString()}\n`);
}

// ---------------------------------------------------
// 7️⃣  Run now (and schedule externally)
// ---------------------------------------------------
runSync().catch((e) => {
  console.error("❌ Unhandled error during sync:", e);
  process.exit(1);
});