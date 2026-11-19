/**
 * Block Kit for: Set super admin / demote super admin
 */
import type { SlackBlock } from "@cheddar/exchange";

export function setSuperAdminBlocks(isSuperAdmin: boolean): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "mrkdwn",
        text: isSuperAdmin
          ? "*You are now a super admin!*\nYou can manage users, Mouse funders, logs, and health."
          : "*You are no longer a super admin.*",
      },
      "level": 1
    },
  ];
}
