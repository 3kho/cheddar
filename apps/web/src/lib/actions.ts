"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  ExchangeError,
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
  removeMouseFunder,
  resumeWheel,
  setCheesemonger,
  setSuperAdmin,
  submitProposal,
  suspendUser,
  syncUser,
  unsuspendUser,
  withdrawProposal,
  type SettlementOutcome,
} from "@cheddar/exchange";
import { and, eq, ne, sql, users } from "@cheddar/db";
import { hackatimeToken, syncNow } from "./accounts";
import { getDb, getExchange, getHackatime } from "./db";
import { env } from "./env";
import { MAX_NAME_LENGTH, formatLatta, parseLatta } from "./format";
import { DEFAULT_SLIPPAGE, capLevels, levelsFor, quoteBuy, quoteSell } from "./market";
import { requote, requoteAll, requoteForWedge } from "./mouse-job";
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

async function signedIn() {
  const u = await currentUser();
  if (!u) throw new ExchangeError("FORBIDDEN", "Please log in first.");
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
    const u = await signedIn();
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
    if (!u.hackatimeUserId) return fail("Link your Hackatime account first.");
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
  /** "svg:<name>" or a small data:image URL; empty for the category's icon. */
  icon: string;
  /** ISO time trading stops, or null to stay open until someone asks to close it. */
  closesAt: string | null;
  /** Multi-outcome only: people can suggest new outcomes later. */
  allowAdditions: boolean;
}

function proposalFields(input: ProposalFormInput) {
  const outcomes = (Array.isArray(input.outcomes) ? input.outcomes : []).map((s) => String(s).trim()).filter(Boolean);
  if (outcomes.length === 1) throw new ExchangeError("INVALID", "A multi-outcome wheel needs at least two outcomes.");
  return {
    title: input.title,
    description: input.description,
    category: input.category,
    resolutionCriteria: input.resolutionCriteria,
    icon: input.icon,
    outcomes: outcomes.length ? outcomes : ["Yes"],
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
    const u = await signedIn();
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
    for (const label of (input.newOutcomes ?? []).map((x) => String(x).trim()).filter(Boolean)) {
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
    const u = await signedIn();
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
    const chance = extra.startChance != null && Number.isFinite(extra.startChance) ? extra.startChance / 100 : undefined;
    const r = await reviewOutcomeRequest(
      await getDb(),
      { requestId, reviewerId: u.id, approve, note, label: extra.label, startChance: chance },
      reviewOpts(),
    );
    if (r.approved) after(() => requote(r.wheel.id));
    revalidatePath("/", "layout");
    return { ok: true, message: r.approved ? `Added “${r.wedge.label}” to ${r.wheel.title}.` : "Suggestion rejected." };
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
    if (approve) {
      const liquidity = Number(extra.liquidity ?? 0);
      const { wheel } = await approveProposal(db, { proposalId, reviewerId: u.id, note, liquidity }, reviewOpts());
      if (liquidity > 0) await requote(wheel.id);
      revalidatePath("/", "layout");
      return { ok: true, message: `Approved: /wheel/${wheel.slug}` };
    }
    await rejectProposal(db, { proposalId, reviewerId: u.id, note }, reviewOpts());
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
    const u = await signedIn();
    const r = await mergePairs(await getDb(), { userId: u.id, wedgeId, shares });
    after(() => requoteForWedge(wedgeId));
    revalidatePath("/", "layout");
    return { ok: true, message: `Redeemed ${r.shares} Yes + No pairs for ${formatLatta(r.paidTicks)}.` };
  });
}

export async function mergeYesSetAction(wheelId: string, shares: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const r = await mergeYesSet(await getDb(), { userId: u.id, wheelId, shares });
    after(() => requote(wheelId));
    revalidatePath("/", "layout");
    return { ok: true, message: `Redeemed ${r.shares} full Yes sets for ${formatLatta(r.paidTicks)}.` };
  });
}

export async function convertNoAction(wheelId: string, wedgeIds: string[], shares: number): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
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
  /** "wedge:<id>", "all_no" or "moldy" */
  choice: string;
  evidence: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    let outcome: SettlementOutcome;
    let winningWedgeId: string | undefined;
    if (input.choice.startsWith("wedge:")) {
      outcome = "wedge_wins";
      winningWedgeId = input.choice.slice("wedge:".length);
    } else if (input.choice === "all_no" || input.choice === "moldy") {
      outcome = input.choice;
    } else {
      return fail("Pick an outcome.");
    }
    await proposeSettlement(await getDb(), {
      wheelId: input.wheelId,
      proposerId: u.id,
      outcome,
      winningWedgeId,
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
    if (approve) {
      if (!proof.trim()) return fail("Add the proof people will see on the wheel before approving.");
      const report = await approveSettlement(db, { settlementId, reviewerId: u.id, note, proof }, reviewOpts());
      revalidatePath("/", "layout");
      const paid = report.reduce((s, r) => s + r.paidTicks, 0);
      return { ok: true, message: `Ripened! Paid out ${formatLatta(paid)}.` };
    }
    await rejectSettlement(db, { settlementId, reviewerId: u.id, note }, reviewOpts());
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

// ---------- moderation ----------

export async function suspendUserAction(userId: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const r = await suspendUser(await getDb(), { userId, actorId: u.id, reason });
    revalidatePath("/", "layout");
    return { ok: true, message: `Suspended. ${r.cancelledOrders} open order(s) cancelled.` };
  });
}

export async function unsuspendUserAction(userId: string, note: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await unsuspendUser(await getDb(), { userId, actorId: u.id, note });
    revalidatePath("/", "layout");
    return { ok: true, message: "Unsuspended." };
  });
}

export async function setCheesemongerAction(userId: string, value: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await setCheesemonger(await getDb(), { userId, actorId: u.id, value });
    revalidatePath("/", "layout");
    return { ok: true, message: value ? "Now a Cheesemonger." : "No longer a Cheesemonger." };
  });
}

export async function setSuperAdminAction(userId: string, value: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    await setSuperAdmin(await getDb(), { userId, actorId: u.id, value });
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

// ---------- profile ----------

export async function updateProfileAction(name: string): Promise<ActionResult> {
  return attempt(async () => {
    const u = await signedIn();
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return fail("Pick a name.");
    if ([...clean].length > MAX_NAME_LENGTH) return fail(`Keep it to ${MAX_NAME_LENGTH} characters or fewer.`);
    if (/[\p{Cc}\p{Cf}]/u.test(clean)) return fail("That name has characters we can't show.");
    const db = await getDb();
    const taken = "That name is taken. Try another.";
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.name}) = lower(${clean})`, ne(users.id, u.id)))
      .limit(1);
    if (other) return fail(taken);
    try {
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
