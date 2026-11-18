/**
 * Slack notifications for Cheddar.
 *
 * Uses the Slack Web API (chat.postMessage) so we can send DMs to users by
 * their Slack user id, plus Block Kit blocks for rich messages.
 *
 * Required env:
 *   SLACK_BOT_TOKEN   xoxb-… token with chat:write, im:write, users:read
 *   SLACK_WEBHOOK_URL optional incoming webhook for channel announcements
 */
import { and, eq, sql, users, type AnyDb } from "@cheddar/db";

const SLACK_API = "https://slack.com/api/chat.postMessage";

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackMessage {
  channel: string;
  text: string; // fallback for notifications / accessibility
  blocks?: SlackBlock[];
}

/** Send one Slack message. Returns the raw API JSON. */
export async function sendSlackMessage(
  token: string,
  message: SlackMessage,
): Promise<{ ok: boolean; error?: string; channel?: string; ts?: string }> {
  const res = await fetch(SLACK_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: message.channel,
      text: message.text,
      ...(message.blocks ? { blocks: message.blocks } : {}),
    }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    channel?: string;
    ts?: string;
  };
  return { ok: !!json.ok, error: json.error, channel: json.channel, ts: json.ts };
}

/** Convenience: send a plain text message. */
export async function sendSlackText(token: string, channel: string, text: string) {
  return sendSlackMessage(token, { channel, text });
}

/**
 * Read Slack user ids of people we can notify.
 * Only users with a slack_id on file are returned.
 */
export async function slackUserIds(
  db: AnyDb,
  opts: {
    /** Only these user ids (null/undefined = all users with slack). */
    onlyIds?: string[];
    /** Exclude these user ids. */
    excludeIds?: string[];
  } = {},
): Promise<string[]> {
  const conds = [sql`${users.slackId} IS NOT NULL`];
  if (opts.onlyIds?.length) {
    conds.push(...opts.onlyIds.map((id) => eq(users.id, id)));
  }
  const rows = await db
    .select({ id: users.id, slackId: users.slackId })
    .from(users)
    .where(and(...conds));

  let ids = rows.map((r) => r.slackId!).filter(Boolean) as string[];
  if (opts.excludeIds?.length) {
    const exclude = new Set(opts.excludeIds);
    ids = ids.filter((s) => !exclude.has(s));
  }
  return ids;
}
