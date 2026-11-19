// Slack Block Kit templates for Cheddar notifications.
// Each file exports a function that returns a Slack blocks array,
// with dynamic values passed as arguments.

export { outcomeApprovedBlocks } from "./outcome-approved";
export { outcomeRejectedBlocks } from "./outcome-rejected";
export { proposalApprovedBlocks } from "./proposal-approved";
export { proposalRejectedBlocks } from "./proposal-rejected";
export { settlementApprovedBlocks } from "./settlement-approved";
export { settlementRejectedBlocks } from "./settlement-rejected";
export { lattaGrantedBlocks } from "./latta-granted";
export { accountSuspendedBlocks } from "./account-suspended";
export { accountUnsuspendedBlocks } from "./account-unsuspended";
export { setCheesemongerBlocks } from "./set-cheesemonger";
export { setSuperAdminBlocks } from "./set-super-admin";
export { tradeReversedBlocks } from "./trade-reversed";
