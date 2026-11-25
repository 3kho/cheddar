-- ------------------------------------------------------------------
-- 0024_slack_channel_state.sql
--  Add tables to track Slack channel membership for the auto-sync job.
-- ------------------------------------------------------------------

-- Table: slack_channel_members
-- One row per user that has ever been invited to the target channel.
CREATE TABLE IF NOT EXISTS slack_channel_members (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id)
);
--> statement-breakpoint
-- Table: slack_channel_left
-- Users that were once in the channel but are no longer members.
-- The sync job reads this table to avoid re-adding people who left.
CREATE TABLE IF NOT EXISTS slack_channel_left (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    left_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id)
);

-- ------------------------------------------------------------------
-- End of migration
-- ------------------------------------------------------------------
