"use client";

import { useState, useTransition } from "react";
import { sendSlackAnnouncement, type ActionResult } from "@/lib/actions";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";

const DEFAULT_BLOCKS = JSON.stringify(
  [
    {
      type: "header",
      text: { type: "plain_text", text: "📢 Cheddar Announcement" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Hi everyone! This is a site-wide announcement from the Cheddar team.\n\nReply in <#general> if you have questions.",
      },
    },
    {
      type: "divider",
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Sent by the Cheddar admin team • :cheese:",
        },
      ],
    },
  ],
  null,
  2,
);

export function SlackAnnounce() {
  const [blocksJson, setBlocksJson] = useState(DEFAULT_BLOCKS);
  const [filter, setFilter] = useState<"all" | "cheesemongers" | "super-admins">("all");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const field =
    "w-full rounded-lg border border-line bg-surface-2 p-3 text-sm font-mono outline-none transition focus:border-primary focus:bg-bg";

  const run = () =>
    start(async () => {
      const r = await safely(sendSlackAnnouncement(blocksJson, filter));
      setMsg(r);
    });

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold mb-3">Slack announcement</h2>
      <p className="text-xs text-muted mb-3">
        Send a Block Kit message as a DM to users. Paste a valid Slack blocks JSON array. Messages are sent as DMs from the Cheddar bot.
      </p>
      <div className="mb-3 flex gap-2">
        {(["all", "cheesemongers", "super-admins"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              filter === f ? "bg-primary text-white" : "bg-surface-2 text-muted hover:bg-hover"
            }`}
          >
            {f === "all" ? "All users" : f === "cheesemongers" ? "Cheesemongers" : "Super admins"}
          </button>
        ))}
      </div>
      <textarea
        value={blocksJson}
        onChange={(e) => setBlocksJson(e.target.value)}
        rows={12}
        placeholder='[{"type": "section", "text": {"type": "mrkdwn", "text": "Hello!"}}]'
        className={field}
        aria-label="Block Kit JSON"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50 hover:bg-primary-hover"
        >
          {busy ? "Sending…" : "Send to Slack"}
        </button>
        <button
          type="button"
          onClick={() => setBlocksJson(DEFAULT_BLOCKS)}
          className="h-9 rounded-md px-2 text-xs font-semibold text-muted hover:text-ink"
        >
          Reset
        </button>
      </div>
      {msg && <div className="mt-2"><Notice result={msg} /></div>}
    </section>
  );
}
