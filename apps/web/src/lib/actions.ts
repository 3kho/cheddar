"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  CHURN_NOT_FOUND,
  addCategory,
  grantLatta,
  removeCategory,
  setCategoryIcon,
  CHURN_PRIVATE,
  ExchangeError,
  RATES,
  payReferralIfDue,
  cleanName,
  renameUser,
  resolveReport,
  submitReport,
  takeRate,
  isOtherLabel,
  addMouseFunder,
  addOutcome,
  requestOutcome,
  reviewOutcomeRequest,
  updateProposal,
  updateWheel,
  approveProposal,
  approveSettlement,
  convertNo,
  mergePairs,
  mergeYesSet,
  proposeSettlement,
  setWheelLiquidity,
  rejectProposal,
  rejectSettlement,
  pauseWheel,
  haltWedge,
  removeMouseFunder,
  resumeWheel,
  resumeWedge,
  setCheesemonger,
  setSuperAdmin,
  submitProposal,
  suspendUser,
  syncUser,
  undoTrade,
  unsuspendUser,
  withdrawProposal,
  haltPassedDateWedges,
  sendSlackMessage,
  slackUserIds,
  type SlackMessage,
  type SlackBlock,
  type SettlementOutcome,
} from "@cheddar/exchange";
import {
  outcomeApprovedBlocks,
  outcomeRejectedBlocks,
  proposalApprovedBlocks,
  proposalRejectedBlocks,
  settlementApprovedBlocks,
  settlementRejectedBlocks,
  lattaGrantedBlocks,
  accountSuspendedBlocks,
  accountUnsuspendedBlocks,
  setCheesemongerBlocks,
  setSuperAdminBlocks,
  tradeReversedBlocks,
} from "@/lib/slack/blocks";
import { and, eq, ne, sql, users, proposals, outcomeRequests, settlements, wheels, type AnyDb, type Tx } from "@cheddar/db";
import { hackatimeToken, syncNow } from "./accounts";
import { getDb, getExchange, getHackatime } from "./db";
import { env } from "./env";
import { formatLatta, parseLatta } from "./format";
import { DEFAULT_SLIPPAGE, capLevels, levelsFor, quoteBuy, quoteSell } from "./market";
import { requote, requoteAll, requoteForWedge } from "./mouse-job";
import { referralConfig } from "./referral";
import { depthFor, wheelChances } from "./queries";
import { currentUser } from "./session";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

/** Turn expected errors into messages; let real bugs surface in the server log. */
async function attempt(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ExchangeError) return fail(e.message);
    console.error(e);
    return fail("Something went wrong. Please try again.");
  }
}

/** Slack token for DMing users. Missing = notifications silently skipped. */
const slackToken = process.env.SLACK_BOT_TOKEN;

/**
 * DM a user on Slack. Fire-and-forget: failures are logged but never break the action.
 * `userId` is a Cheddar user id (we look up their Slack id from the DB).
 */
async function notifySlackUser(
  db: AnyDb | Tx,
  userId: string,
  message: Omit<SlackMessage, "channel">,
) {
  if (!slackToken) {
    console.error("Slack notify skipped: SLACK_BOT_TOKEN not configured");
    return;
  }
  try {
    const [row] = await db
      .select({ slackId: users.slackId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row?.slackId) {
      console.error(`Slack notify skipped: user ${userId} has no slack_id`);
      return;
    }
    await sendSlackMessage(slackToken, { channel: row.slackId, ...message });
  } catch (e) {
    console.error("Slack notify failed:", e);
  }
}

/** Notify several users the same message. */
async function notifySlackUsers(
  db: AnyDb | Tx,
  userIds: string[],
  message: Omit<SlackMessage, "channel">,
) {
  console.log(`Slack notify: sending to ${userIds.length} user(s): ${userIds.join(", ")}`);
  await Promise.all(userIds.map((id) => notifySlackUser(db, id, message)));
}

/** After a trade: if this person was invited and has now traded enough, pay the referral reward. */
function settleReferral(userId: string) {
  after(async () => {
    try {
      await payReferralIfDue(await getDb(), { refereeId: userId }, referralConfig);
    } catch (e) {
      console.error(e);
    }
  });
}

/** `fairPlay: true` for anything that trades, proposes or suggests: those need the rules ticked first. */
async function signedIn(fairPlay = false) {
  const u = await currentUser();
  if (!u) throw new ExchangeError("FORBIDDEN", "Please log in first.");
  if (fairPlay && !u.hasAcceptedFairPlay) {
    throw new ExchangeError("FORBIDDEN", "Please accept the fair play rules first (use the banner at the top of the page).");
  }
  return u;
}

const reviewOpts = () => ({ allowSelfReview: env.allowSelfReview });

// ---------- trading ----------

export interface TradeInput {
  wedgeId: string;
  outcome: "YES" | "NO";
  side: "BUY" | "SELL";
  mode: "market" | "limit";
  /** Limit price in cents (1..99). */
  price?: number;
  /** Shares: for limit orders and market sells. */
  shares?: number;
  /** Latta to spend, as typed (e.g. "12.5"): market buys only. */
  amount?: string;
  /** Market orders only: how far past the best price (cents) a fill may go. */
  slippage?: number;
}

export async function placeOrderAction(input: TradeInput): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    await takeRate(await getDb(), u.id, RATES.order);
    settleReferral(u.id);
    const ex = await getExchange();
    const label = `${input.side === "BUY" ? "Bought" : "Sold"} ${input.outcome === "YES" ? "Yes" : "No"}`;

    if (input.mode === "limit") {
      const r = await ex.placeOrder({
        userId: u.id,
        wedgeId: input.wedgeId,
        outcome: input.outcome,
        side: input.side,
        price: Number(input.price),
        qty: Number(input.shares),
      });
      after(() => requoteForWedge(input.wedgeId));
      revalidatePath("/", "layout");
      if (r.status === "filled") return { ok: true, message: `${label}: ${r.filled} shares filled.` };
      return {
        ok: true,
        message: r.filled ? `${r.filled} shares filled, ${r.remaining} resting on the book.` : `Order placed: ${r.remaining} shares at ${input.price}¢.`,
      };
    }

    // Market orders: quote against the current book within the slippage cap, then send an IOC
    // limited to the worst price inside that cap, so the order can never fill beyond it.
    const depth = (await depthFor([input.wedgeId])).get(input.wedgeId)!;
    const slippage = Number.isFinite(input.slippage) ? Number(input.slippage) : DEFAULT_SLIPPAGE;
    const { levels, cap } = capLevels(levelsFor(depth, input.outcome, input.side), input.side, slippage);
    if (cap == null) return fail("Nobody is on the other side right now. Try a limit order.");
    let qty: number;
    let limit: number | null;
    let partial = false;
    if (input.side === "BUY") {
      const budget = parseLatta(input.amount ?? "");
      if (!budget) return fail("Enter an amount of Latta Cheese to spend.");
      const q = quoteBuy(levels, budget);
      qty = q.shares;
      limit = q.worstPrice;
      partial = budget - q.cost >= (levels.at(-1)?.[0] ?? 100) && q.shares > 0;
    } else {
      const want = Number(input.shares);
      if (!Number.isInteger(want) || want <= 0) return fail("Enter how many shares to sell.");
      const q = quoteSell(levels, want);
      qty = q.shares;
      limit = q.worstPrice;
      partial = q.shares < want;
    }
    if (!qty || limit == null) return fail(`Nothing fills within ${cap}¢. Raise your slippage or use a limit order.`);
    const r = await ex.placeOrder({
      userId: u.id,
      wedgeId: input.wedgeId,
      outcome: input.outcome,
      side: input.side,
      price: limit,
      qty,
      tif: "IOC",
    });
    after(() => requoteForWedge(input.wedgeId));
    revalidatePath("/", "layout");
    if (!r.filled) return fail("The price moved before your order arrived. Nothing was filled.");
    const cash = r.trades.reduce((s, t) => s + Math.abs(t.legs.find((l) => l.userId === u.id)?.cash ?? 0), 0);
    const rest = partial ? ` The rest would have cost more than ${cap}¢, so it wasn't filled.` : "";
    return { ok: true, message: `${label}: ${r.filled} shares for ${formatLatta(cash)}.${rest}` };
  });
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await (await getExchange()).cancelOrder(u.id, orderId);
    revalidatePath("/", "layout");
    return { ok: true, message: "Order cancelled." };
  });
}

// ---------- Churn ----------

export async function syncNowAction(): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    if (!u.hackatimeUserId && !u.slackId) return fail("Link your Hackatime account first.");
    const r = await syncNow(u.id);
    revalidatePath("/", "layout");
    switch (r.status) {
      case "cooldown":
        return fail(`You can sync again at ${r.retryAt.toLocaleTimeString("en-US")}.`);
      case "credited":
        return { ok: true, message: `${formatLatta(r.creditedTicks)} churned${r.toMouse ? " for The Mouse" : ""}!` };
      case "no_change":
        return { ok: true, message: "Up to date. Go code some more!" };
      case "skipped_untrusted":
        return fail("Hackatime has flagged your account, so Churn is paused. Ask in #hackatime-help.");
      default:
        if (r.error?.startsWith(CHURN_PRIVATE)) {
          return fail("Your Hackatime stats are private, so we can't see your hours. Make them public in Hackatime's settings, or link your Hackatime account.");
        }
        if (r.error?.startsWith(CHURN_NOT_FOUND)) {
          return fail("Hackatime has no coding for your Slack account yet. Start coding with Hackatime, or link your Hackatime account if it uses a different one.");
        }
        return fail(`Hackatime didn't answer: ${r.error ?? "unknown error"}`);
    }
  });
}

// ---------- proposals ----------

/** What the propose / edit form sends. */
export interface ProposalFormInput {
  title: string;
  description: string;
  category: string;
  resolutionCriteria: string;
  /** Outcome labels for a multi-outcome wheel; empty for Yes/No. */
  outcomes: string[];
  /** For date markets: ISO datetime for each outcome, parallel to outcomes. Null for non-date markets. */
  dateValues: string[] | null;
  /** "svg:<name>" or a small data:image URL; empty for the category's icon. */
  icon: string;
  /** ISO time trading stops, or null to stay open until someone asks to close it. */
  closesAt: string | null;
  /** Multi-outcome only: people can suggest new outcomes later. */
  allowAdditions: boolean;
}

function proposalFields(input: ProposalFormInput) {
  const outcomes = (Array.isArray(input.outcomes) ? input.outcomes : []).map((s) => String(s).trim()).filter(Boolean);
  const dateValues = input.dateValues
    ? input.dateValues
        .map((s) => {
          const d = new Date(s);
          return Number.isNaN(d.getTime()) ? null : d;
        })
        .filter((d): d is Date => d !== null)
    : null;
  if (outcomes.length === 1) throw new ExchangeError("INVALID", "A multi-outcome wheel needs at least two outcomes.");
  return {
    title: input.title,
    description: input.description,
    category: input.category,
    resolutionCriteria: input.resolutionCriteria,
    icon: input.icon,
    outcomes: outcomes.length ? outcomes : ["Yes"],
    dateValues: dateValues?.length ? dateValues : null,
    closesAt: parseClose(input.closesAt),
    allowAdditions: outcomes.length > 1 && !!input.allowAdditions,
  };
}

function parseClose(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ExchangeError("INVALID", "That close date isn't valid.");
  return d;
}

export async function submitProposalAction(input: ProposalFormInput): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    await takeRate(await getDb(), u.id, RATES.proposal);
    await submitProposal(await getDb(), { proposerId: u.id, ...proposalFields(input) });
    revalidatePath("/propose");
    revalidatePath("/cheesemongers");
    return { ok: true, message: "Sent to the Cheesemongers for review." };
  });
}

/** Cheesemongers: rewrite a pending proposal before approving it. */
export async function updateProposalAction(proposalId: string, input: ProposalFormInput): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await updateProposal(await getDb(), { proposalId, editorId: u.id, fields: proposalFields(input) });
    revalidatePath("/cheesemongers");
    revalidatePath("/propose");
    return { ok: true, message: "Proposal updated." };
  });
}

/** Cheesemongers: edit a live wheel. Existing outcomes can be renamed; new ones are added. */
export async function updateWheelAction(
  wheelId: string,
  input: ProposalFormInput & { labels: Record<string, string>; newOutcomes: string[] },
): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    await updateWheel(db, {
      wheelId,
      editorId: u.id,
      fields: {
        title: input.title,
        description: input.description,
        category: input.category,
        resolutionCriteria: input.resolutionCriteria,
        icon: input.icon,
        closesAt: parseClose(input.closesAt),
        allowAdditions: !!input.allowAdditions,
        labels: input.labels ?? {},
      },
    });
    const added: string[] = [];
    // "Other" goes in last so it stays the bottom row.
    const toAdd = (input.newOutcomes ?? []).map((x) => String(x).trim()).filter(Boolean);
    toAdd.sort((a, b) => Number(isOtherLabel(a)) - Number(isOtherLabel(b)));
    for (const label of toAdd) {
      await addOutcome(db, { wheelId, actorId: u.id, label });
      added.push(label);
    }
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    return { ok: true, message: added.length ? `Saved, and added ${added.join(", ")}.` : "Saved." };
  });
}

// ---------- new outcomes ----------

export async function requestOutcomeAction(wheelId: string, label: string, note: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    await takeRate(await getDb(), u.id, RATES.outcomeRequest);
    const r = await requestOutcome(await getDb(), { wheelId, userId: u.id, label, note });
    revalidatePath("/", "layout");
    return { ok: true, message: `Suggested “${r.label}”. A Cheesemonger will look at it.` };
  });
}

export async function reviewOutcomeAction(
  requestId: string,
  approve: boolean,
  note: string,
  extra: ReviewExtra = {},
): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const [request] = await db
      .select({ proposerId: outcomeRequests.proposerId, label: outcomeRequests.label, wheelId: outcomeRequests.wheelId })
      .from(outcomeRequests)
      .where(eq(outcomeRequests.id, requestId))
      .limit(1);
    const chance = extra.startChance != null && Number.isFinite(extra.startChance) ? extra.startChance / 100 : undefined;
    const r = await reviewOutcomeRequest(
      db,
      { requestId, reviewerId: u.id, approve, note, label: extra.label, startChance: chance },
      reviewOpts(),
    );
    if (r.approved) {
      await notifySlackUser(db, request!.proposerId, {
        text: `Your outcome suggestion “${request!.label}” was approved and added to the wheel.`,
        blocks: outcomeApprovedBlocks(request!.label),
      });
      after(() => requote(r.wheel.id));
      revalidatePath("/", "layout");
      return { ok: true, message: `Added “${r.wedge.label}” to ${r.wheel.title}.` };
    }
    await notifySlackUser(db, request!.proposerId, {
      text: `Your outcome suggestion “${request!.label}” was rejected.`,
      blocks: outcomeRejectedBlocks(request!.label, note),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Suggestion rejected." };
  });
}

export async function withdrawProposalAction(proposalId: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await withdrawProposal(await getDb(), { proposalId, proposerId: u.id });
    revalidatePath("/propose");
    return { ok: true, message: "Proposal withdrawn." };
  });
}

export async function reviewProposalAction(
  proposalId: string,
  approve: boolean,
  note: string,
  extra: ReviewExtra = {},
): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const [proposal] = await db
      .select({ proposerId: proposals.proposerId })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);
    if (approve) {
      const liquidity = Number(extra.liquidity ?? 0);
      const { wheel } = await approveProposal(db, { proposalId, reviewerId: u.id, note, liquidity }, reviewOpts());
      if (liquidity > 0) await requote(wheel.id);
      await notifySlackUser(db, proposal!.proposerId, {
        text: `Your proposal “${wheel.title}” was approved and is now live.`,
        blocks: proposalApprovedBlocks(wheel.title, wheel.slug),
      });
      revalidatePath("/", "layout");
      return { ok: true, message: `Approved: /wheel/${wheel.slug}` };
    }
    await rejectProposal(db, { proposalId, reviewerId: u.id, note }, reviewOpts());
    await notifySlackUser(db, proposal!.proposerId, {
      text: `Your proposal “${proposal?.proposerId ? "" : ""}” was rejected.`,
      blocks: proposalRejectedBlocks(note),
    });
    revalidatePath("/cheesemongers");
    return { ok: true, message: "Proposal rejected." };
  });
}

/** Extra fields some review queues collect. */
export interface ReviewExtra {
  /** Settlements: the public proof shown on the wheel. */
  proof?: string;
  /** Proposals: The Mouse's liquidity on the new wheel. */
  liquidity?: number;
  /** New outcomes: the label to add (if tidied up), and its starting chance in percent. */
  label?: string;
  startChance?: number;
}

// ---------- The Mouse ----------

export async function setLiquidityAction(wheelId: string, liquidity: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    await setWheelLiquidity(db, { wheelId, actorId: u.id, liquidity, startPrices: await wheelChances(wheelId) });
    await requote(wheelId);
    revalidatePath("/", "layout");
    return { ok: true, message: liquidity > 0 ? `The Mouse now quotes with depth ${liquidity}.` : "The Mouse stopped quoting here." };
  });
}

// ---------- linked outcomes ----------

export async function mergePairsAction(wedgeId: string, shares: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    const r = await mergePairs(await getDb(), { userId: u.id, wedgeId, shares });
    after(() => requoteForWedge(wedgeId));
    revalidatePath("/", "layout");
    return { ok: true, message: `Redeemed ${r.shares} Yes + No pairs for ${formatLatta(r.paidTicks)}.` };
  });
}

export async function mergeYesSetAction(wheelId: string, shares: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    const r = await mergeYesSet(await getDb(), { userId: u.id, wheelId, shares });
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    return { ok: true, message: `Redeemed ${r.shares} full Yes sets for ${formatLatta(r.paidTicks)}.` };
  });
}

export async function convertNoAction(wheelId: string, wedgeIds: string[], shares: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    const r = await convertNo(await getDb(), { userId: u.id, wheelId, wedgeIds, shares });
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    const parts = [];
    if (r.yesOn.length) parts.push(`${r.shares} Yes on ${r.yesOn.length} other outcome${r.yesOn.length === 1 ? "" : "s"}`);
    if (r.paidTicks) parts.push(formatLatta(r.paidTicks));
    return { ok: true, message: `Converted: you got ${parts.join(" and ")}.` };
  });
}

// ---------- ripening ----------

export async function proposeSettlementAction(input: {
  wheelId: string;
  /** "wedge:<id>", "all_no", "all_yes", "moldy", or "date:<iso-date>" */
  choice: string;
  /** For multi-winner markets: comma-separated winning wedge ids (e.g. "wedge:<id1>,wedge:<id2>") */
  winningWedgeIds?: string;
  /** For date markets: the event date ISO string */
  eventDate?: string;
  evidence: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn(true);
    let outcome: SettlementOutcome;
    let winningWedgeId: string | undefined;
    let winningWedgeIds: string[] | undefined;
    let eventDate: string | undefined;

    if (input.choice.startsWith("wedge:")) {
      outcome = "wedge_wins";
      winningWedgeId = input.choice.slice("wedge:".length);
    } else if (input.choice.startsWith("date:")) {
      outcome = "date";
      eventDate = input.choice.slice("date:".length);
    } else if (input.choice === "all_no") {
      outcome = "all_no";
    } else if (input.choice === "all_yes") {
      outcome = "all_yes";
    } else if (input.choice === "moldy") {
      outcome = "moldy";
    } else if (input.choice === "multi_yes") {
      outcome = "multi_yes";
    } else {
      return fail("Pick an outcome.");
    }

    // Parse multi-winner wedge ids
    if (input.winningWedgeIds && input.choice === "multi_yes") {
      winningWedgeIds = input.winningWedgeIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => id.startsWith("wedge:") ? id.slice("wedge:".length) : id);
    }

    await proposeSettlement(await getDb(), {
      wheelId: input.wheelId,
      proposerId: u.id,
      outcome,
      winningWedgeId,
      winningWedgeIds,
      eventDate,
      evidence: input.evidence,
    });
    after(() => requote(input.wheelId)); // pulls The Mouse's quotes while it ripens
    revalidatePath("/", "layout");
    return { ok: true, message: "Request sent. Trading is paused until a Cheesemonger reviews it." };
  });
}

export async function reviewSettlementAction(
  settlementId: string,
  approve: boolean,
  note: string,
  extra: ReviewExtra = {},
): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const proof = extra.proof ?? "";
    const [settlement] = await db
      .select({ proposerId: settlements.proposerId, wheelId: settlements.wheelId, outcome: settlements.outcome })
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);
    if (approve) {
      if (!proof.trim()) return fail("Add the proof people will see on the wheel before approving.");
      const report = await approveSettlement(db, { settlementId, reviewerId: u.id, note, proof }, reviewOpts());
      revalidatePath("/", "layout");
      const paid = report.reduce((s, r) => s + r.paidTicks, 0);
      await notifySlackUser(db, settlement!.proposerId, {
        text: `Your settlement request was approved — paid out ${formatLatta(paid)}.`,
        blocks: settlementApprovedBlocks(paid, proof),
      });
      return { ok: true, message: `Ripened! Paid out ${formatLatta(paid)}.` };
    }
    await rejectSettlement(db, { settlementId, reviewerId: u.id, note }, reviewOpts());
    await notifySlackUser(db, settlement!.proposerId, {
      text: `Your settlement request was rejected.`,
      blocks: settlementRejectedBlocks(note),
    });
    after(() => requoteAll()); // trading reopened: The Mouse quotes again
    revalidatePath("/", "layout");
    return { ok: true, message: "Settlement rejected; trading reopened." };
  });
}

// ---------- Mouse funders ----------

export async function addFunderAction(slackId: string, note: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const { userId, swept } = await addMouseFunder(db, { slackId, addedById: u.id, note });
    // Pull their Hackatime hours into The Mouse now (by Slack id if they never linked).
    const churn = await syncUser(db, getHackatime(), userId, { tokenFor: hackatimeToken });
    revalidatePath("/", "layout");
    const parts = ["Added."];
    if (swept && (swept.sweptTicks || swept.movedPositions || swept.cancelledOrders)) {
      parts.push(
        `Swept ${formatLatta(swept.sweptTicks)}, ${swept.movedPositions} position(s) and ${swept.cancelledOrders} order(s) to The Mouse.`,
      );
    }
    if (churn.status === "credited") parts.push(`Fed The Mouse ${formatLatta(churn.creditedTicks)} from their coding hours.`);
    else if (churn.status === "no_change") parts.push("Their hours are already counted.");
    else if (churn.status === "skipped_untrusted") parts.push("Hackatime has flagged their account, so their hours don't count yet.");
    else parts.push(`Couldn't read their Hackatime yet (${churn.error ?? "unknown error"}). Churn will keep retrying.`);
    return { ok: true, message: parts.join(" ") };
  });
}

export async function removeFunderAction(slackId: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await removeMouseFunder(await getDb(), { slackId, removedById: u.id });
    revalidatePath("/admin");
    return { ok: true, message: "Removed. Their future Churn goes to them." };
  });
}

// ---------- grants ----------

/** Super admin: give someone Latta from the house. `amount` is in Latta (up to 2 decimals). */
export async function grantLattaAction(userId: string, amount: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const text = amount.trim().replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter an amount like 50 or 12.5." };
    const ticks = Math.round(Number(text) * 100);
    await grantLatta(db, { recipientId: userId, actorId: u.id, ticks, reason });
    await notifySlackUser(db, userId, {
      text: `You were granted ${text} Lc: ${reason}`,
      blocks: lattaGrantedBlocks(text, reason),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Granted ${text} Lc.` };
  });
}

// ---------- categories ----------

export async function addCategoryAction(name: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await addCategory(await getDb(), { name, actorId: u.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Category added." };
  });
}

export async function setCategoryIconAction(name: string, icon: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await setCategoryIcon(await getDb(), { name, icon, actorId: u.id });
    revalidatePath("/", "layout");
    return { ok: true, message: icon ? "Icon updated." : "Back to the default icon." };
  });
}

export async function removeCategoryAction(name: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const { moved } = await removeCategory(await getDb(), { name, actorId: u.id });
    revalidatePath("/", "layout");
    return { ok: true, message: moved ? `Removed. ${moved} wheel${moved === 1 ? "" : "s"} moved to Hack Club.` : "Removed." };
  });
}

// ---------- moderation ----------

export async function suspendUserAction(userId: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const r = await suspendUser(db, { userId, actorId: u.id, reason });
    await notifySlackUser(db, userId, {
      text: `Your account has been suspended: ${reason}`,
      blocks: accountSuspendedBlocks(reason),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Suspended. ${r.cancelledOrders} open order(s) cancelled.` };
  });
}

export async function unsuspendUserAction(userId: string, note: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    await unsuspendUser(db, { userId, actorId: u.id, note });
    await notifySlackUser(db, userId, {
      text: `Your Cheddar account has been unsuspended. You can trade again.${note ? `\nNote: ${note}` : ""}`,
      blocks: accountUnsuspendedBlocks(note),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Unsuspended." };
  });
}

export async function setCheesemongerAction(userId: string, value: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    await setCheesemonger(db, { userId, actorId: u.id, value });
    await notifySlackUser(db, userId, {
      text: value ? "You are now a Cheesemonger!" : "You are no longer a Cheesemonger.",
      blocks: setCheesemongerBlocks(value),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: value ? "Now a Cheesemonger." : "No longer a Cheesemonger." };
  });
}

export async function setSuperAdminAction(userId: string, value: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    await setSuperAdmin(db, { userId, actorId: u.id, value });
    await notifySlackUser(db, userId, {
      text: value ? "You are now a super admin!" : "You are no longer a super admin.",
      blocks: setSuperAdminBlocks(value),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: value ? "Now a super admin (and a Cheesemonger)." : "No longer a super admin." };
  });
}

export async function pauseWheelAction(wheelId: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await pauseWheel(await getDb(), { wheelId, actorId: u.id, reason });
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    return { ok: true, message: "Trading paused." };
  });
}

export async function resumeWheelAction(wheelId: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await resumeWheel(await getDb(), { wheelId, actorId: u.id });
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    return { ok: true, message: "Trading resumed." };
  });
}

export async function haltWedgeAction(wedgeId: string, halt: boolean, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    if (halt) {
      await haltWedge(await getDb(), { wedgeId, actorId: u.id, reason });
      revalidatePath("/", "layout");
      return { ok: true, message: "Outcome halted. No new orders can be placed on it." };
    }
    await resumeWedge(await getDb(), { wedgeId, actorId: u.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Outcome reopened for trading." };
  });
}

/** Cheesemonger: halt any date options whose time has passed on a wheel. */
export async function haltPassedDateWedgesAction(wheelId: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const [wheel] = await db
      .select({ marketType: wheels.marketType })
      .from(wheels)
      .where(eq(wheels.id, wheelId))
      .limit(1);
    if (!wheel) return { ok: false, error: "Wheel not found" };
    if (wheel.marketType !== "date") return { ok: false, error: "This wheel is not a date market." };
    const r = await haltPassedDateWedges(db, { actorId: u.id });
    revalidatePath("/", "layout");
    return { ok: true, message: `Halted ${r.halted} passed date outcome${r.halted === 1 ? "" : "s"}.` };
  });
}

/** Cheesemonger: reverse a single trade (both legs), restoring positions, cash and any filled orders. */
export async function undoTradeAction(tradeId: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const db = await getDb();
    const r = await undoTrade(db, { actorId: u.id, tradeId });
    // Fire-and-forget Slack notification — never fail the trade reversal because of it
    try {
      await notifySlackUsers(db, r.users, {
        text: "A trade you were part of was reversed by a Cheesemonger. Your cash and shares are back to what they were.",
        blocks: tradeReversedBlocks(),
      });
    } catch (e) {
      console.error("Slack notification failed after trade reversal:", e);
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Trade reversed. Positions and cash are back to what they were." };
  });
}

/** Admin: send a Block Kit announcement as a DM to all users (or a filtered subset). */
export async function sendSlackAnnouncement(
  blocksJson: string,
  filter: "all" | "cheesemongers" | "super-admins" = "all",
): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    if (!u.isSuperAdmin) return fail("Only super admins can send announcements.");
    if (!slackToken) return fail("SLACK_BOT_TOKEN is not configured on the server.");

    let blocks: SlackBlock[];
    try {
      blocks = JSON.parse(blocksJson);
      if (!Array.isArray(blocks)) throw new Error("blocks must be a JSON array");
    } catch (e) {
      return fail("Invalid Block Kit JSON. Paste a valid blocks array.");
    }

    const db = await getDb();
    const conds = [sql`${users.slackId} IS NOT NULL`, eq(users.isBot, false)];
    if (filter === "cheesemongers") conds.push(eq(users.isCheesemonger, true));
    if (filter === "super-admins") conds.push(eq(users.isSuperAdmin, true));

    const rows = await db
      .select({ id: users.id, slackId: users.slackId, name: users.name })
      .from(users)
      .where(and(...conds));

    const text = blocks
      .map((b) => {
        if (b.type === "section" && b.text && typeof b.text === "object" && "text" in b.text) {
          return String((b.text as { text?: string }).text);
        }
        return "";
      })
      .join("\n")
      .slice(0, 2000) || "Cheddar announcement";

    await Promise.all(
      rows.map((row) =>
        sendSlackMessage(slackToken, {
          channel: row.slackId!,
          text,
          blocks,
        }),
      ),
    );

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Sent announcement to ${rows.length} user${rows.length === 1 ? "" : "s"}.`,
    };
  });
}

// ---------- profile ----------

export async function updateProfileAction(name: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const clean = cleanName(name);
    const db = await getDb();
    const taken = "That name is taken. Try another.";
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.name}) = lower(${clean})`, ne(users.id, u.id)))
      .limit(1);
    if (other) return fail(taken);
    try {
      if (clean !== u.name) await takeRate(db, u.id, RATES.rename);
      await db.update(users).set({ name: clean }).where(eq(users.id, u.id));
    } catch (e) {
      // Lost a race with someone claiming the same name: the unique index caught it.
      if ((e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") return fail(taken);
      throw e;
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  });
}

// ---------- fair play ----------

export async function acceptFairPlayAction(): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await (await getDb()).update(users).set({ fairPlayAcceptedAt: new Date() }).where(eq(users.id, u.id));
    revalidatePath("/", "layout");
    return { ok: true, message: "Thanks! Happy trading." };
  });
}

// ---------- reports & renames ----------

export async function reportAction(targetType: "wheel" | "user", targetId: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await submitReport(await getDb(), { reporterId: u.id, targetType, targetId, reason });
    revalidatePath("/cheesemongers");
    return { ok: true, message: "Thanks, a Cheesemonger will take a look." };
  });
}

export async function resolveReportAction(reportId: string, result: "actioned" | "dismissed", note: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await resolveReport(await getDb(), { reportId, actorId: u.id, action: result, note });
    revalidatePath("/cheesemongers");
    return { ok: true, message: result === "actioned" ? "Marked as handled." : "Dismissed." };
  });
}

export async function renameUserAction(userId: string, name: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await renameUser(await getDb(), { userId, actorId: u.id, name, reason: "Renamed by a Cheesemonger" });
    revalidatePath("/", "layout");
    return { ok: true, message: "Renamed." };
  });
}

// ---------- tour ----------

/** Called when someone finishes the tour (`understood` ticked) or skips it. */
export async function finishTourAction(understood: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const now = new Date();
    await (await getDb())
      .update(users)
      .set({ tourSeenAt: now, ...(understood ? { tourConfirmedAt: now } : {}) })
      .where(eq(users.id, u.id));
    revalidatePath("/", "layout");
    return { ok: true, message: understood ? "Great, you're ready." : "Skipped. You can reopen the tour any time from the footer." };
  });
}
