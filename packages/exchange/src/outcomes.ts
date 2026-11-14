/**
 * Changing a live wheel: Cheesemongers can edit everything about it except the outcomes people
 * already hold (those can be renamed, not removed), and can add new outcomes to a multi-outcome
 * wheel. On wheels with allowAdditions, anyone can suggest an outcome for a Cheesemonger to add.
 *
 * Adding an outcome never touches anyone's shares: every wedge is its own Yes/No market, so
 * existing positions keep their collateral. A new outcome just means one more way for every
 * existing wedge to resolve No. The Mouse carves the new outcome's starting chance out of the
 * others in proportion, so its prices still add up to 100%.
 */
import { and, asc, eq, outcomeRequests, positions, sql, users, wedges, wheels, type Tx, type AnyDb } from "@cheddar/db";
import { ensureMouse } from "./churn";
import { ExchangeError, runTx } from "./errors";
import { anchorFor, outcomeKeys, payoffs, type Holding } from "./lmsr";
import { logEvent } from "./log";
import { mousePrices } from "./mouse";
import { MAX_WEDGES, cleanCloseTime, cleanIcon, isOtherLabel } from "./proposals";
import { assertReviewer, requireText, type ReviewOptions } from "./review";

const SETTLED = ["resolved", "moldy"];

async function requireCheesemonger(tx: Tx, userId: string, what: string) {
  const [u] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, userId));
  if (!u?.ok) throw new ExchangeError("FORBIDDEN", `only Cheesemongers can ${what}`);
}

const cleanLabel = (label: string) => requireText(label, "outcome", 80);

function startChance(p: number | undefined, n: number): number {
  if (p == null || !Number.isFinite(p)) return 1 / (n + 1);
  if (p < 0.01 || p > 0.9) throw new ExchangeError("INVALID", "the starting chance must be between 1% and 90%");
  return p;
}

/** Insert the wedge and re-anchor The Mouse. The wheel row must already be locked. */
async function addOutcomeInTx(tx: Tx, wheelId: string, label: string, chance?: number) {
  const [w] = await tx.select().from(wheels).where(eq(wheels.id, wheelId));
  if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
  if (w.status !== "open") throw new ExchangeError("INVALID", "outcomes can only be added while the wheel is open");
  const ws = await tx.select().from(wedges).where(eq(wedges.wheelId, wheelId)).orderBy(asc(wedges.sortOrder), asc(wedges.createdAt));
  if (ws.length < 2) throw new ExchangeError("INVALID", "a Yes/No wheel can't get more outcomes");
  if (ws.length >= MAX_WEDGES) throw new ExchangeError("INVALID", `a wheel can have at most ${MAX_WEDGES} outcomes`);
  if (ws.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
    throw new ExchangeError("INVALID", `“${label}” is already an outcome`);
  }
  const p0 = startChance(chance, ws.length);
  // On a wheel with an "Other", new outcomes slot in above it so "Other" stays the last row.
  const other = w.allowAdditions ? ws.find((x) => isOtherLabel(x.label)) : undefined;
  let sortOrder = Math.max(...ws.map((x) => x.sortOrder)) + 1;
  if (other) {
    sortOrder = other.sortOrder;
    await tx.update(wedges).set({ sortOrder: other.sortOrder + 1 }).where(eq(wedges.id, other.id));
  }
  const [wedge] = await tx
    .insert(wedges)
    .values({ wheelId, label, sortOrder })
    .returning();

  if (w.liquidity > 0 && w.mmAnchor) {
    const mouse = await ensureMouse(tx);
    const oldIds = ws.map((x) => x.id);
    const pos = await tx
      .select()
      .from(positions)
      .where(and(eq(positions.userId, mouse.id), sql`${positions.wedgeId} IN (${sql.join(oldIds.map((id) => sql`${id}`), sql`, `)})`));
    const holdings = new Map<string, Holding>(pos.map((p) => [p.wedgeId, { yes: p.yesShares, no: p.noShares }]));
    const before = mousePrices(w, oldIds, holdings);
    const ids = [...oldIds, wedge!.id];
    const probs = [...oldIds.map((id) => (before?.get(id) ?? 1 / oldIds.length) * (1 - p0)), p0];
    const a = anchorFor(probs, payoffs(ids, holdings), w.liquidity);
    const keys = outcomeKeys(ids);
    await tx
      .update(wheels)
      .set({ mmAnchor: Object.fromEntries(keys.map((k, i) => [k, a[i]!])) })
      .where(eq(wheels.id, wheelId));
  }
  return { wheel: w, wedge: wedge! };
}

/** A Cheesemonger adds an outcome to a live multi-outcome wheel directly. */
export async function addOutcome(
  db: AnyDb,
  input: { wheelId: string; actorId: string; label: string; startChance?: number },
) {
  const label = cleanLabel(input.label);
  return runTx(db, async (tx) => {
    await requireCheesemonger(tx, input.actorId, "add outcomes");
    await tx.select({ id: wheels.id }).from(wheels).where(eq(wheels.id, input.wheelId)).for("update");
    const r = await addOutcomeInTx(tx, input.wheelId, label, input.startChance);
    await logEvent(tx, {
      actorId: input.actorId,
      action: "outcome.add",
      targetType: "wheel",
      targetId: input.wheelId,
      details: { title: r.wheel.title, slug: r.wheel.slug, label, wedgeId: r.wedge.id },
    });
    return r;
  });
}

/** Anyone signed in suggests an outcome on a wheel that's open to new ones. */
export async function requestOutcome(db: AnyDb, input: { wheelId: string; userId: string; label: string; note?: string }) {
  const label = cleanLabel(input.label);
  const note = (input.note ?? "").trim().slice(0, 1_000);
  return runTx(db, async (tx) => {
    const [u] = await tx.select({ isBot: users.isBot, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, input.userId));
    if (!u || u.isBot) throw new ExchangeError("FORBIDDEN", "only people can suggest outcomes");
    if (u.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
    const [w] = await tx.select().from(wheels).where(eq(wheels.id, input.wheelId)).for("update");
    if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
    if (!w.allowAdditions) throw new ExchangeError("INVALID", "this wheel isn't taking new outcomes");
    if (w.status !== "open") throw new ExchangeError("INVALID", "this wheel isn't open any more");
    const ws = await tx.select({ label: wedges.label }).from(wedges).where(eq(wedges.wheelId, w.id));
    if (ws.some((x) => x.label.toLowerCase() === label.toLowerCase())) throw new ExchangeError("INVALID", `“${label}” is already an outcome`);
    const dup = await tx
      .select({ id: outcomeRequests.id })
      .from(outcomeRequests)
      .where(
        and(
          eq(outcomeRequests.wheelId, w.id),
          eq(outcomeRequests.status, "pending"),
          sql`lower(${outcomeRequests.label}) = lower(${label})`,
        ),
      );
    if (dup.length) throw new ExchangeError("INVALID", `someone already suggested “${label}”; it's waiting for a Cheesemonger`);
    const mine = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(outcomeRequests)
      .where(and(eq(outcomeRequests.proposerId, input.userId), eq(outcomeRequests.status, "pending")));
    if ((mine[0]?.n ?? 0) >= 10) throw new ExchangeError("INVALID", "you have 10 suggestions waiting already; give the Cheesemongers a moment");
    const [r] = await tx.insert(outcomeRequests).values({ wheelId: w.id, proposerId: input.userId, label, note }).returning();
    await logEvent(tx, {
      actorId: input.userId,
      action: "outcome.request",
      targetType: "outcome",
      targetId: r!.id,
      details: { title: w.title, slug: w.slug, label },
    });
    return r!;
  });
}

export async function reviewOutcomeRequest(
  db: AnyDb,
  input: { requestId: string; reviewerId: string; approve: boolean; note?: string; label?: string; startChance?: number },
  opts: ReviewOptions = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    const [r] = await tx.select().from(outcomeRequests).where(eq(outcomeRequests.id, input.requestId)).for("update");
    if (!r) throw new ExchangeError("NOT_FOUND", "suggestion not found");
    if (r.status !== "pending") throw new ExchangeError("INVALID", `suggestion is already ${r.status}`);
    await assertReviewer(tx, input.reviewerId, r.proposerId, opts);
    const done = { reviewerId: input.reviewerId, reviewNote: input.note?.trim() || null, reviewedAt: now };
    if (!input.approve) {
      await tx.update(outcomeRequests).set({ ...done, status: "rejected" }).where(eq(outcomeRequests.id, r.id));
      await logEvent(tx, {
        actorId: input.reviewerId,
        action: "outcome.reject",
        targetType: "outcome",
        targetId: r.id,
        details: { label: r.label, note: done.reviewNote },
      });
      return { approved: false as const };
    }
    await tx.select({ id: wheels.id }).from(wheels).where(eq(wheels.id, r.wheelId)).for("update");
    // The Cheesemonger may tidy the label up before adding it.
    const label = input.label?.trim() ? cleanLabel(input.label) : r.label;
    const added = await addOutcomeInTx(tx, r.wheelId, label, input.startChance);
    await tx
      .update(outcomeRequests)
      .set({ ...done, status: "approved", wedgeId: added.wedge.id, label })
      .where(eq(outcomeRequests.id, r.id));
    await logEvent(tx, {
      actorId: input.reviewerId,
      action: "outcome.approve",
      targetType: "outcome",
      targetId: r.id,
      details: { title: added.wheel.title, slug: added.wheel.slug, label, wedgeId: added.wedge.id },
    });
    return { approved: true as const, ...added };
  });
}

export interface WheelEdit {
  title: string;
  description?: string;
  category?: string | null;
  resolutionCriteria: string;
  icon?: string | null;
  closesAt?: Date | null;
  allowAdditions?: boolean;
  /** Renames, by wedge id. Outcomes can't be removed once people may hold them. */
  labels?: Record<string, string>;
}

/** A Cheesemonger edits a live (or ripening) wheel. */
export async function updateWheel(
  db: AnyDb,
  input: { wheelId: string; editorId: string; fields: WheelEdit },
  opts: { now?: () => Date } = {},
) {
  const now = (opts.now ?? (() => new Date()))();
  const f = input.fields;
  const next = {
    title: requireText(f.title, "title", 200),
    description: (f.description ?? "").trim().slice(0, 10_000),
    category: f.category?.trim().slice(0, 40) || null,
    resolutionCriteria: requireText(f.resolutionCriteria, "resolution criteria", 5_000),
    icon: cleanIcon(f.icon),
  };
  return runTx(db, async (tx) => {
    await requireCheesemonger(tx, input.editorId, "edit wheels");
    const [w] = await tx.select().from(wheels).where(eq(wheels.id, input.wheelId)).for("update");
    if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
    if (SETTLED.includes(w.status)) throw new ExchangeError("INVALID", "this wheel is already settled");
    const ws = await tx.select().from(wedges).where(eq(wedges.wheelId, w.id)).orderBy(asc(wedges.sortOrder));

    // An unchanged close time that has already passed is fine; a new one must be in the future.
    const closesAt =
      f.closesAt === undefined
        ? w.closesAt
        : f.closesAt && w.closesAt && f.closesAt.getTime() === w.closesAt.getTime()
          ? w.closesAt
          : cleanCloseTime(f.closesAt, now);
    const allowAdditions = ws.length > 1 && (f.allowAdditions ?? w.allowAdditions);

    const renames: { id: string; from: string; to: string }[] = [];
    for (const [id, raw] of Object.entries(f.labels ?? {})) {
      const wedge = ws.find((x) => x.id === id);
      if (!wedge) throw new ExchangeError("INVALID", "that outcome isn't on this wheel");
      const to = cleanLabel(raw);
      if (to !== wedge.label) renames.push({ id, from: wedge.label, to });
    }
    const finalLabels = ws.map((x) => renames.find((r) => r.id === x.id)?.to ?? x.label);
    if (new Set(finalLabels.map((l) => l.toLowerCase())).size !== finalLabels.length) {
      throw new ExchangeError("INVALID", "outcomes must be unique");
    }
    if (renames.length) {
      // Two steps so swapping two labels doesn't trip the unique (wheel, label) index.
      for (const r of renames) await tx.update(wedges).set({ label: `__renaming__${r.id}` }).where(eq(wedges.id, r.id));
      for (const r of renames) await tx.update(wedges).set({ label: r.to }).where(eq(wedges.id, r.id));
    }

    const [updated] = await tx
      .update(wheels)
      .set({
        ...next,
        closesAt,
        allowAdditions,
        // Pushing a passed close time out (or removing it) reopens trading.
        ...(w.status === "closed" && (!closesAt || closesAt > now) ? { status: "open" as const } : {}),
      })
      .where(eq(wheels.id, w.id))
      .returning();
    const changed = [
      ...(Object.keys(next) as (keyof typeof next)[]).filter((k) => (w[k] ?? null) !== (next[k] ?? null)),
      ...((w.closesAt?.getTime() ?? null) !== (closesAt?.getTime() ?? null) ? ["closesAt"] : []),
      ...(w.allowAdditions !== allowAdditions ? ["allowAdditions"] : []),
      ...(renames.length ? ["outcomes"] : []),
    ];
    await logEvent(tx, {
      actorId: input.editorId,
      action: "wheel.edit",
      targetType: "wheel",
      targetId: w.id,
      details: { title: next.title, slug: w.slug, changed, renames: renames.map(({ from, to }) => ({ from, to })) },
    });
    return updated!;
  });
}
