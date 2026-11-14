/** Reports: anyone signed in can flag a wheel or a user's name; Cheesemongers resolve them. */
import { and, eq, reports, users, wheels, type AnyDb } from "@cheddar/db";
import { ExchangeError, runTx } from "./errors";
import { logEvent } from "./log";
import { RATES, takeRate } from "./rate";
import { requireText } from "./review";

const isUniqueViolation = (e: unknown) => {
  for (let cur: unknown = e; cur && typeof cur === "object"; cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
};

export async function submitReport(
  db: AnyDb,
  input: { reporterId: string; targetType: "wheel" | "user"; targetId: string; reason: string },
) {
  const reason = requireText(input.reason, "reason", 500);
  if (reason.length < 10) throw new ExchangeError("INVALID", "Tell us a bit more (at least 10 characters) so we can act on it.");
  try {
    return await runTx(db, async (tx) => {
      const [me] = await tx.select({ isBot: users.isBot, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, input.reporterId));
      if (!me || me.isBot) throw new ExchangeError("FORBIDDEN", "only people can send reports");
      if (me.suspendedAt) throw new ExchangeError("FORBIDDEN", "your account is suspended by the Cheesemongers");
      if (input.targetType === "wheel") {
        const [w] = await tx.select({ id: wheels.id }).from(wheels).where(eq(wheels.id, input.targetId));
        if (!w) throw new ExchangeError("NOT_FOUND", "wheel not found");
      } else {
        if (input.targetId === input.reporterId) throw new ExchangeError("INVALID", "you can't report yourself");
        const [u] = await tx.select({ isBot: users.isBot }).from(users).where(eq(users.id, input.targetId));
        if (!u || u.isBot) throw new ExchangeError("NOT_FOUND", "user not found");
      }
      await takeRate(tx, input.reporterId, RATES.report);
      const [r] = await tx
        .insert(reports)
        .values({ reporterId: input.reporterId, targetType: input.targetType, targetId: input.targetId, reason })
        .returning();
      return r!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ExchangeError("INVALID", "You've already reported this and a Cheesemonger hasn't looked yet. Thanks!");
    throw e;
  }
}

/** A Cheesemonger closes a report: "actioned" (they did something about it) or "dismissed". */
export async function resolveReport(
  db: AnyDb,
  input: { reportId: string; actorId: string; action: "actioned" | "dismissed"; note?: string },
) {
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  await runTx(db, async (tx) => {
    const [a] = await tx.select({ ok: users.isCheesemonger }).from(users).where(eq(users.id, input.actorId));
    if (!a?.ok) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can handle reports");
    const [r] = await tx.select().from(reports).where(eq(reports.id, input.reportId)).for("update");
    if (!r) throw new ExchangeError("NOT_FOUND", "report not found");
    if (r.status !== "open") throw new ExchangeError("INVALID", `report is already ${r.status}`);
    await tx
      .update(reports)
      .set({ status: input.action, resolverId: input.actorId, resolverNote: note, resolvedAt: new Date() })
      .where(and(eq(reports.id, r.id), eq(reports.status, "open")));
    await logEvent(tx, {
      actorId: input.actorId,
      action: "report.resolve",
      targetType: "report",
      targetId: r.id,
      details: { targetType: r.targetType, targetId: r.targetId, result: input.action, note },
    });
  });
}
