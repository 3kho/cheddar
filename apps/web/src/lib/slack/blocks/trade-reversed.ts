/**
 * Block Kit for: Trade reversed
 */
import type { SlackBlock } from "@cheddar/exchange";

export function tradeReversedBlocks(): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "mrkdwn",
        text: `*Trade reversed*\nA Cheesemonger undid a trade you were part of. Your cash and shares are back to what they were.`,
      },
      "level": 1
    },
  ];
}
