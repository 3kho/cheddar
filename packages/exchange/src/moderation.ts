/**
 * Cheesemonger moderation. Every action is checked, applied and logged in one transaction.
 */
import { and, asc, categories, eq, ne, proposals, sql, users, wedges, wheels, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { cancelUserOrders } from "./exchange";
import { logEvent } from "./log";
import { cleanIcon } from "./proposals";
import { requireText } from "./review";

async function assertCheesemonger(tx: Tx, actorId: string) {
  const [u] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, actorId));
  if (!u?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can do that");
}

async function assertSuperAdmin(tx: Tx, actorId: string) {
  const [u] = await tx.select({ ok: users.isSuperAdmin }).from(users).where(eq(users.id, actorId));
  if (!u?.ok) throw new ExchangeError("FORBIDDEN", "only super admins can do that");
}

async function lockUser(tx: Tx, userId: string) {
  const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  if (!u) throw new ExchangeError("NOT_FOUND", "user not found");
  return u;
}

/**
 * Suspend a user: they can still browse, but can't trade, propose or settle.
 * Their open orders are cancelled and escrow returned. Balances and shares are untouched.
 */
export async function suspendUser(
  db: AnyDb,
  input: { userId: string; actorId: string; reason: string },
  opts: { now?: () => Date } = {},
) {
  const reason = requireText(input.reason, "reason", 500);
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    if (input.userId === input.actorId) throw new ExchangeError("INVALID", "you can't suspend yourself");
    const u = await lockUser(tx, input.userId);
    if (u.isSuperAdmin) throw new ExchangeError("INVALID", "remove their super admin role before suspending them");
    if (u.isCheesemonger) throw new ExchangeError("INVALID", "demote this Cheesemonger before suspending them");
    if (u.suspendedAt) throw new ExchangeError("INVALID", "already suspended");
    const { cancelled } = await cancelUserOrders(tx, u.id, "suspended", now);
    await tx.update(users).set({ suspendedAt: now, suspendReason: reason }).where(eq(users.id, u.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "user.suspend",
      targetType: "user",
      targetId: u.id,
      details: { name: u.name, slackId: u.slackId, reason, cancelledOrders: cancelled },
    });
    return { cancelledOrders: cancelled };
  });
}

export async function unsuspendUser(db: AnyDb, input: { userId: string; actorId: string; note?: string }) {
  await runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    const u = await lockUser(tx, input.userId);
    if (!u.suspendedAt) throw new ExchangeError("INVALID", "not suspended");
    await tx.update(users).set({ suspendedAt: null, suspendReason: null }).where(eq(users.id, u.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "user.unsuspend",
      targetType: "user",
      targetId: u.id,
      details: { name: u.name, slackId: u.slackId, note: input.note ?? null, wasSuspendedFor: u.suspendReason },
    });
  });
}

export const MAX_NAME_LENGTH = 32;

/** Tidy a display name: collapse spaces, 1..32 characters, nothing invisible. */
export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new ExchangeError("INVALID", "Pick a name.");
  if ([...name].length > MAX_NAME_LENGTH) throw new ExchangeError("INVALID", `Keep it to ${MAX_NAME_LENGTH} characters or fewer.`);
  if (/[\p{Cc}\p{Cf}]/u.test(name)) throw new ExchangeError("INVALID", "That name has characters we can't show.");
  return name;
}

/** A Cheesemonger changes someone's display name (e.g. an offensive one). Names stay unique. */
export async function renameUser(db: AnyDb, input: { userId: string; actorId: string; name: string; reason: string }) {
  const name = cleanName(input.name);
  const reason = requireText(input.reason, "reason", 500);
  await runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    const u = await lockUser(tx, input.userId);
    if (u.isBot) throw new ExchangeError("INVALID", "bots can't be renamed");
    const [clash] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.name}) = lower(${name})`, ne(users.id, u.id)))
      .limit(1);
    if (clash) throw new ExchangeError("INVALID", "that name is taken");
    await tx.update(users).set({ name }).where(eq(users.id, u.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "user.rename",
      targetType: "user",
      targetId: u.id,
      details: { from: u.name, to: name, slackId: u.slackId, reason },
    });
  });
}

/** Make or remove a Cheesemonger (super admins only). Super admins stay Cheesemongers. */
export async function setCheesemonger(db: AnyDb, input: { userId: string; actorId: string; value: boolean }) {
  await runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    if (!input.value && input.userId === input.actorId) throw new ExchangeError("INVALID", "you can't demote yourself");
    const u = await lockUser(tx, input.userId);
    if (!input.value && u.isSuperAdmin) throw new ExchangeError("INVALID", "remove their super admin role first");
    if (u.isBot) throw new ExchangeError("INVALID", "bots can't be Cheesemongers");
    if (input.value && u.suspendedAt) throw new ExchangeError("INVALID", "unsuspend them first");
    if (u.isCheesemonger === input.value) return;
    await tx.update(users).set({ isCheesemonger: input.value }).where(eq(users.id, u.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: input.value ? "user.promote" : "user.demote",
      targetType: "user",
      targetId: u.id,
      details: { name: u.name, slackId: u.slackId },
    });
  });
}

/**
 * Make or remove a super admin (super admins only). Making one also makes them a Cheesemonger.
 * You can't remove yourself, so there's always one left.
 */
export async function setSuperAdmin(db: AnyDb, input: { userId: string; actorId: string; value: boolean }) {
  await runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    if (!input.value && input.userId === input.actorId) throw new ExchangeError("INVALID", "you can't remove your own super admin role");
    const u = await lockUser(tx, input.userId);
    if (u.isBot) throw new ExchangeError("INVALID", "bots can't be super admins");
    if (input.value && u.suspendedAt) throw new ExchangeError("INVALID", "unsuspend them first");
    if (u.isSuperAdmin === input.value) return;
    await tx
      .update(users)
      .set(input.value ? { isSuperAdmin: true, isCheesemonger: true } : { isSuperAdmin: false })
      .where(eq(users.id, u.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: input.value ? "user.super_admin" : "user.super_admin_remove",
      targetType: "user",
      targetId: u.id,
      details: { name: u.name, slackId: u.slackId },
    });
  });
}

/** Stop new orders on a wheel (cancelling still works). Separate from settlement. */
export async function pauseWheel(
  db: AnyDb,
  input: { wheelId: string; actorId: string; reason: string },
  opts: { now?: () => Date } = {},
) {
  const reason = requireText(input.reason, "reason", 500);
  const now = (opts.now ?? (() => new Date()))();
  await runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    const [w] = await tx.select().from(wheels).where(eq(wheels.id, input.wheelId)).for("update");
    if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
    if (w.status === "resolved" || w.status === "moldy") throw new ExchangeError("INVALID", "this wheel is already settled");
    if (w.tradingPausedAt) throw new ExchangeError("INVALID", "already paused");
    // Lock the wedges so any order in flight finishes first and every later one sees the pause.
    await tx.select({ id: wedges.id }).from(wedges).where(eq(wedges.wheelId, w.id)).orderBy(asc(wedges.id)).for("update");
    await tx.update(wheels).set({ tradingPausedAt: now, pauseReason: reason }).where(eq(wheels.id, w.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "wheel.pause",
      targetType: "wheel",
      targetId: w.id,
      details: { title: w.title, slug: w.slug, reason },
    });
  });
}

export async function resumeWheel(db: AnyDb, input: { wheelId: string; actorId: string }) {
  await runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    const [w] = await tx.select().from(wheels).where(and(eq(wheels.id, input.wheelId))).for("update");
    if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
    if (!w.tradingPausedAt) throw new ExchangeError("INVALID", "not paused");
    await tx.update(wheels).set({ tradingPausedAt: null, pauseReason: null }).where(eq(wheels.id, w.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "wheel.resume",
      targetType: "wheel",
      targetId: w.id,
      details: { title: w.title, slug: w.slug, wasPausedFor: w.pauseReason },
    });
  });
}

/** Halt a single outcome (wedge) on a wheel: no new orders on it, but the rest of the wheel keeps trading. Cancelling still works. */
export async function haltWedge(
  db: AnyDb,
  input: { wedgeId: string; actorId: string; reason: string },
  opts: { now?: () => Date } = {},
) {
  const reason = requireText(input.reason, "reason", 500);
  const now = (opts.now ?? (() => new Date()))();
  return runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    const [wedge] = await tx.select().from(wedges).where(eq(wedges.id, input.wedgeId)).for("update");
    if (!wedge) throw new ExchangeError("NOT_FOUND", "outcome not found");
    if (wedge.status !== "open") throw new ExchangeError("INVALID", `this outcome is already ${wedge.status}`);
    await tx.update(wedges).set({ status: "halted", bookVersion: wedge.bookVersion + 1 }).where(eq(wedges.id, wedge.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "wedge.halt",
      targetType: "wedge",
      targetId: wedge.id,
      details: { label: wedge.label, wheelId: wedge.wheelId, reason },
    });
  });
}

/** Re-open a halted outcome so trading on it resumes. */
export async function resumeWedge(db: AnyDb, input: { wedgeId: string; actorId: string }) {
  return runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    const [wedge] = await tx.select().from(wedges).where(eq(wedges.id, input.wedgeId)).for("update");
    if (!wedge) throw new ExchangeError("NOT_FOUND", "outcome not found");
    if (wedge.status !== "halted") throw new ExchangeError("INVALID", "this outcome is not halted");
    await tx.update(wedges).set({ status: "open", bookVersion: wedge.bookVersion + 1 }).where(eq(wedges.id, wedge.id));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "wedge.resume",
      targetType: "wedge",
      targetId: wedge.id,
      details: { label: wedge.label, wheelId: wedge.wheelId },
    });
  });
}

/** The category wheels fall back to when theirs is removed. It can't be removed itself. */
export const DEFAULT_CATEGORY = "Hack Club";

/** Super admins: add a category wheels can be filed under. */
export async function addCategory(db: AnyDb, input: { name: string; actorId: string }) {
  const name = requireText(input.name, "category", 40);
  await runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    const [dupe] = await tx.select({ n: categories.name }).from(categories).where(sql`lower(${categories.name}) = lower(${name})`);
    if (dupe) throw new ExchangeError("INVALID", `"${dupe.n}" already exists`);
    await tx.insert(categories).values({ name });
    await logEvent(tx, { actorId: input.actorId, action: "category.add", targetType: "category", targetId: name, details: { name } });
  });
}

/**
 * Super admins: remove a category. Wheels (and pending proposals) filed under it move to
 * "Hack Club". Returns how many wheels moved.
 */
export async function removeCategory(db: AnyDb, input: { name: string; actorId: string }): Promise<{ moved: number }> {
  return runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    if (input.name === DEFAULT_CATEGORY) throw new ExchangeError("INVALID", `"${DEFAULT_CATEGORY}" is the fallback category and can't be removed`);
    const gone = await tx.delete(categories).where(eq(categories.name, input.name)).returning({ n: categories.name });
    if (!gone.length) throw new ExchangeError("NOT_FOUND", "category not found");
    await tx.insert(categories).values({ name: DEFAULT_CATEGORY }).onConflictDoNothing();
    const moved = await tx.update(wheels).set({ category: DEFAULT_CATEGORY }).where(eq(wheels.category, input.name)).returning({ id: wheels.id });
    const movedProposals = await tx
      .update(proposals)
      .set({ category: DEFAULT_CATEGORY })
      .where(and(eq(proposals.category, input.name), eq(proposals.status, "pending")))
      .returning({ id: proposals.id });
    await logEvent(tx, {
      actorId: input.actorId,
      action: "category.remove",
      targetType: "category",
      targetId: input.name,
      details: { name: input.name, wheelsMoved: moved.length, proposalsMoved: movedProposals.length, movedTo: DEFAULT_CATEGORY },
    });
    return { moved: moved.length };
  });
}

/** Super admins: set (or clear, with an empty icon) the icon wheels in a category show when they have none of their own. */
export async function setCategoryIcon(db: AnyDb, input: { name: string; icon: string | null; actorId: string }) {
  const icon = cleanIcon(input.icon);
  await runTx(db, async (tx) => {
    await assertSuperAdmin(tx, input.actorId);
    const done = await tx.update(categories).set({ icon }).where(eq(categories.name, input.name)).returning({ n: categories.name });
    if (!done.length) throw new ExchangeError("NOT_FOUND", "category not found");
    await logEvent(tx, {
      actorId: input.actorId,
      action: "category.icon",
      targetType: "category",
      targetId: input.name,
      // Uploaded pictures are big; the log only needs to know it changed.
      details: { name: input.name, icon: icon?.startsWith("data:") ? "uploaded image" : icon },
    });
  });
}
