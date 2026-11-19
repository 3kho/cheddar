/**
 * Block Kit for: Set Cheesemonger / demote Cheesemonger
 */
import type { SlackBlock } from "@cheddar/exchange";

export function setCheesemongerBlocks(isCheesemonger: boolean): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "mrkdwn",
        text: isCheesemonger
          ? "*You are now a Cheesemonger!*\nYou can review proposals, outcomes, settlements, and moderate wheels."
          : "*You are no longer a Cheesemonger.*",
      },
      "level": 1
    },
  ];
}
