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
  /** Multi-outcome only: let people suggest new outcomes after launch. */
  allowAdditions?: boolean;
}

/** Everything about a proposal except who sent it. */
export type ProposalFields = Omit<ProposalInput, "proposerId">;

/** The catch-all outcome that wheels open to new outcomes always carry (like Manifold's "Other"). */
export const OTHER_LABEL = "Other";
export const isOtherLabel = (label: string) => label.trim().toLowerCase() === OTHER_LABEL.toLowerCase();

function cleanFields(input: ProposalFields, now: Date) {
  let outcomes = cleanOutcomes(input.outcomes);
  // A wheel that takes new outcomes needs an "Other", always last: it wins when none of the listed
  // outcomes (including ones added later) do, so the list never has to be complete.
  if (outcomes.length > 1 && input.allowAdditions) {
    outcomes = cleanOutcomes([...outcomes.filter((o) => !isOtherLabel(o)), OTHER_LABEL]);
  }
  return {
    title: requireText(input.title, "title", 200),
    description: (input.description ?? "").trim().slice(0, 10_000),
    category: input.category?.trim().slice(0, 40) || null,
    resolutionCriteria: requireText(input.resolutionCriteria, "resolution criteria", 5_000),
    closesAt: cleanCloseTime(input.closesAt, now),
    icon: cleanIcon(input.icon),
    outcomes,
    allowAdditions: outcomes.length > 1 && !!input.allowAdditions,
  };
}

/** Null for "open until closed by request"; otherwise a valid future time. */
export function cleanCloseTime(closesAt: Date | null | undefined, now: Date): Date | null {
  if (closesAt == null) return null;
  if (!(closesAt instanceof Date) || Number.isNaN(closesAt.getTime())) throw new ExchangeError("INVALID", "that close time isn't a valid date");
  if (closesAt <= now) throw new ExchangeError("INVALID", "close time must be in the future");
  if (closesAt.getTime() - now.getTime() > 5 * 365 * 86_400_000) throw new ExchangeError("INVALID", "close time must be within 5 years");
  return closesAt;
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
  const fields = cleanFields(input, now);
  return runTx(db, async (tx) => {
    const [u] = await tx.select({ isBot: users.isBot, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, input.proposerId));
    if (!u || u.isBot) throw new ExchangeError("FORBIDDEN", "only people can propose markets");
    if (u.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
    const [p] = await tx
      .insert(proposals)
      .values({ proposerId: input.proposerId, ...fields })
      .returning();
    await logEvent(tx, {
      actorId: input.proposerId,
      action: "proposal.submit",
      targetType: "proposal",
      targetId: p!.id,
      details: { title: fields.title },
    });
    return p!;
  });
}

/**
 * A Cheesemonger rewrites a pending proposal: any field, including the outcomes, the type
 * (Yes/No or multiple choice), the close time and whether new outcomes can be suggested.
 */
export async function updateProposal(
  db: AnyDb,
  input: { proposalId: string; editorId: string; fields: ProposalFields },
  opts: { now?: () => Date } = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  const fields = cleanFields(input.fields, now);
  return runTx(db, async (tx) => {
    const [ed] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, input.editorId));
    if (!ed?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can edit proposals");
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for("update");
    if (!p) throw new ExchangeError("NOT_FOUND", "proposal not found");
    if (p.status !== "pending") throw new ExchangeError("INVALID", `proposal is already ${p.status}`);
    const [next] = await tx.update(proposals).set(fields).where(eq(proposals.id, p.id)).returning();
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (k) => JSON.stringify(p[k] ?? null) !== JSON.stringify(fields[k] ?? null),
    );
    await logEvent(tx, {
      actorId: input.editorId,
      action: "proposal.edit",
      targetType: "proposal",
      targetId: p.id,
      details: { title: fields.title, changed },
    });
    return next!;
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
        allowAdditions: p.outcomes.length > 1 && p.allowAdditions,
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

export function cleanOutcomes(raw: string[]): string[] {
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
