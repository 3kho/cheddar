/**
 * Cheesemonger moderation. Every action is checked, applied and logged in one transaction.
 */
import { and, asc, eq, users, wedges, wheels, type AnyDb, type Tx } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { cancelUserOrders } from "./exchange";
import { logEvent } from "./log";
import { requireText } from "./review";

async function assertCheesemonger(tx: Tx, actorId: string) {
  const [u] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, actorId));
  if (!u?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can do that");
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
    await assertCheesemonger(tx, input.actorId);
    if (input.userId === input.actorId) throw new ExchangeError("INVALID", "you can't suspend yourself");
    const u = await lockUser(tx, input.userId);
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
    await assertCheesemonger(tx, input.actorId);
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

/** Make or remove a Cheesemonger. You can't demote yourself (so there's always one left). */
export async function setCheesemonger(db: AnyDb, input: { userId: string; actorId: string; value: boolean }) {
  await runTx(db, async (tx) => {
    await assertCheesemonger(tx, input.actorId);
    if (!input.value && input.userId === input.actorId) throw new ExchangeError("INVALID", "you can't demote yourself");
    const u = await lockUser(tx, input.userId);
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
