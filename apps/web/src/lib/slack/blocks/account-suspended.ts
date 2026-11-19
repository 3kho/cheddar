/**
 * Block Kit for: Account suspended
 */
import type { SlackBlock } from "@cheddar/exchange";

export function accountSuspendedBlocks(reason: string): SlackBlock[] {
  return [
    {
			"type": "container",
			"block_id": "bkb_container_standard",
			"title": {
				"type": "plain_text",
				"text": "Account suspended"
			},
			"width": "standard",
			"child_blocks": [
				{
					"type": "rich_text",
					"block_id": "rt-simple",
					"elements": [
						{
							"type": "rich_text_section",
							"elements": [
								{
									"type": "text",
									"text": `Your Cheddar account has been suspended.\nReason: ${reason}`
								}
							]
						}
					]
				}
			]
		}
  ];
}
