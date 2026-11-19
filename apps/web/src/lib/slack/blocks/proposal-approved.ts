/**
 * Block Kit for: Proposal approved
 */
import type { SlackBlock } from "@cheddar/exchange";

export function proposalApprovedBlocks(title: string, slug: string): SlackBlock[] {
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
						"text": `*Proposal approved*\nYour proposal “${title}” was approved and is now live at /wheel/${slug}.`
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
							"text": `Thnx for Improving Cheddar`
						}
					]
				}
			]
		}
  ];
}
