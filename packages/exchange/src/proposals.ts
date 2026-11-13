import { randomUUID } from "node:crypto";
import { eq, proposals, users, wedges, wheels, type AnyDb } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { logEvent } from "./log";
import { anchorFor, outcomeKeys } from "./lmsr";
import { MAX_LIQUIDITY } from "./mouse";
import { assertReviewer, requireText, type ReviewOptions } from "./review";

export interface ProposalInput {
  proposerId: string;
  title: string;
  description?: string;
  category?: string;
  resolutionCriteria: string;
  /** Optional hard stop for trading. Normally wheels stay open until a close request is approved. */
  closesAt?: Date | null;
  /** "svg:<name>" (a built-in icon) or a small data:image/png|jpeg|webp;base64 URL. */
  icon?: string | null;
  /** Wedge labels. One label makes a binary Yes/No wheel. */
  outcomes: string[];
}

/** Uploaded icons are resized in the browser; anything bigger than this was not. */
export const MAX_ICON_CHARS = 200_000;
const SVG_ICON = /^svg:[a-z0-9-]{1,32}$/;
const IMAGE_ICON = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Accepts a built-in icon name or a small raster data URL. SVG uploads are refused (they can carry script). */
export function cleanIcon(icon: string | null | undefined): string | null {
  const v = (icon ?? "").trim();
  if (!v) return null;
  if (SVG_ICON.test(v)) return v;
  if (v.length > MAX_ICON_CHARS) throw new ExchangeError("INVALID", "that image is too big; use a smaller one");
  if (IMAGE_ICON.test(v)) return v;
  throw new ExchangeError("INVALID", "the icon must be a PNG, JPEG or WebP image, or one of the built-in icons");
}

export const MAX_WEDGES = 30;

/** Anyone signed in can ask for a market; a Cheesemonger approves it into a Wheel. */
export async function submitProposal(db: AnyDb, input: ProposalInput, opts: ReviewOptions = {}) {
  const now = (opts.now ?? (() => new Date()))();
  const title = requireText(input.title, "title", 200);
  const resolutionCriteria = requireText(input.resolutionCriteria, "resolution criteria", 5_000);
  const outcomes = cleanOutcomes(input.outcomes);
  const icon = cleanIcon(input.icon);
  if (input.closesAt != null && (!(input.closesAt instanceof Date) || Number.isNaN(input.closesAt.getTime()) || input.closesAt <= now)) {
    throw new ExchangeError("INVALID", "close time must be in the future");
  }
  return runTx(db, async (tx) => {
    const [u] = await tx.select({ isBot: users.isBot, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, input.proposerId));
    if (!u || u.isBot) throw new ExchangeError("FORBIDDEN", "only people can propose markets");
    if (u.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
    const [p] = await tx
      .insert(proposals)
      .values({
        proposerId: input.proposerId,
        title,
        description: (input.description ?? "").trim(),
        category: input.category?.trim() || null,
        resolutionCriteria,
        closesAt: input.closesAt ?? null,
        icon,
        outcomes,
      })
      .returning();
    await logEvent(tx, { actorId: input.proposerId, action: "proposal.submit", targetType: "proposal", targetId: p!.id, details: { title } });
    return p!;
  });
}

export async function approveProposal(
  db: AnyDb,
  input: {
    proposalId: string;
    reviewerId: string;
    note?: string;
    /** The Mouse's depth on the new wheel (0 = no market maker). Prices start even. */
    liquidity?: number;
  },
  opts: ReviewOptions = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  const liquidity = Math.trunc(Number(input.liquidity ?? 0));
  if (!Number.isFinite(liquidity) || liquidity < 0 || liquidity > MAX_LIQUIDITY) {
    throw new ExchangeError("INVALID", "liquidity must be a whole number of shares (0 for none)");
  }
  return runTx(db, async (tx) => {
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for("update");
    if (!p) throw new ExchangeError("NOT_FOUND", "proposal not found");
    if (p.status !== "pending") throw new ExchangeError("INVALID", `proposal is already ${p.status}`);
    await assertReviewer(tx, input.reviewerId, p.proposerId, opts);
    if (p.closesAt && p.closesAt <= now) throw new ExchangeError("INVALID", "this proposal's close time has already passed");

    const [wheel] = await tx
      .insert(wheels)
      .values({
        slug: slugify(p.title),
        title: p.title,
        description: p.description,
        category: p.category,
        resolutionCriteria: p.resolutionCriteria,
        closesAt: p.closesAt,
        icon: p.icon,
        creatorId: p.proposerId,
        proposalId: p.id,
      })
      .returning();
    const ws = await tx
      .insert(wedges)
      .values(p.outcomes.map((label, i) => ({ wheelId: wheel!.id, label, sortOrder: i })))
      .returning();
    if (liquidity > 0) {
      const keys = outcomeKeys(ws.map((w) => w.id));
      const a = anchorFor(keys.map(() => 1 / keys.length), keys.map(() => 0), liquidity);
      await tx
        .update(wheels)
        .set({ liquidity, mmAnchor: Object.fromEntries(keys.map((k, i) => [k, a[i]!])) })
        .where(eq(wheels.id, wheel!.id));
    }
    await tx
      .update(proposals)
      .set({ status: "approved", reviewerId: input.reviewerId, reviewNote: input.note ?? null, reviewedAt: now })
      .where(eq(proposals.id, p.id));
    await logEvent(tx, {
      actorId: input.reviewerId,
      action: "proposal.approve",
      targetType: "proposal",
      targetId: p.id,
      details: { title: p.title, wheelId: wheel!.id, slug: wheel!.slug, note: input.note ?? null, liquidity },
    });
    return { wheel: wheel!, wedges: ws };
  });
}

export async function rejectProposal(
  db: AnyDb,
  input: { proposalId: string; reviewerId: string; note?: string },
  opts: ReviewOptions = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  await runTx(db, async (tx) => {
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for("update");
    if (!p) throw new ExchangeError("NOT_FOUND", "proposal not found");
    if (p.status !== "pending") throw new ExchangeError("INVALID", `proposal is already ${p.status}`);
    await assertReviewer(tx, input.reviewerId, p.proposerId, opts);
    await tx
      .update(proposals)
      .set({ status: "rejected", reviewerId: input.reviewerId, reviewNote: input.note ?? null, reviewedAt: now })
      .where(eq(proposals.id, p.id));
    await logEvent(tx, {
      actorId: input.reviewerId,
      action: "proposal.reject",
      targetType: "proposal",
      targetId: p.id,
      details: { title: p.title, note: input.note ?? null },
    });
  });
}

export async function withdrawProposal(db: AnyDb, input: { proposalId: string; proposerId: string }) {
  await runTx(db, async (tx) => {
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for("update");
    if (!p || p.proposerId !== input.proposerId) throw new ExchangeError("NOT_FOUND", "proposal not found");
    if (p.status !== "pending") throw new ExchangeError("INVALID", `proposal is already ${p.status}`);
    await tx.update(proposals).set({ status: "withdrawn" }).where(eq(proposals.id, p.id));
    await logEvent(tx, { actorId: input.proposerId, action: "proposal.withdraw", targetType: "proposal", targetId: p.id, details: { title: p.title } });
  });
}

function cleanOutcomes(raw: string[]): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ExchangeError("INVALID", "add at least one outcome");
  if (raw.length > MAX_WEDGES) throw new ExchangeError("INVALID", `at most ${MAX_WEDGES} outcomes`);
  const out = raw.map((o) => requireText(o, "outcome", 80));
  if (new Set(out.map((o) => o.toLowerCase())).size !== out.length) {
    throw new ExchangeError("INVALID", "outcomes must be unique");
  }
  return out;
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "wheel"}-${randomUUID().slice(0, 6)}`;
}
