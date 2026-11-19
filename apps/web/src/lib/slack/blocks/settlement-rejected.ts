/**
 * Block Kit for: Settlement rejected
 */
import type { SlackBlock } from "@cheddar/exchange";

export function settlementRejectedBlocks(note?: string): SlackBlock[] {
  return [
    {
			"type": "container",
			"block_id": "bkb_container_icon_subtitle",
			"title": {
				"type": "plain_text",
				"text": "Cheddar Update"
			},
			"icon": {
				"type": "image",
				"image_url": "https://cheddar.navdeep.tech/icon.png",
				"alt_text": "Cheddar icon"
			},
			"child_blocks": [
				{
					"type": "section",
					"block_id": "section-1",
					"text": {
						"type": "mrkdwn",
						"text": `*Settlement rejected*\nYour settlement request was rejected by a Cheesemonger.`
					}
				},
				{
					"type": "divider",
					"block_id": "divider-1"
				},
				{
					"type": "context",
					"block_id": "context-1",
					"elements": [
						{
							"type": "mrkdwn",
							"text": `${note ? `\nNote: ${note}` : "Thnx for Improving Cheddar"}`
						}
					]
				}
			]
		}
  ];
}
