import { auditLog, type AnyDb, type Tx } from "@cheddar/db";

export type AuditAction =
  | "proposal.submit"
  | "proposal.approve"
  | "proposal.reject"
  | "proposal.withdraw"
  | "proposal.edit"
  | "wheel.edit"
  | "outcome.request"
  | "outcome.approve"
  | "outcome.reject"
  | "outcome.add"
  | "settlement.propose"
  | "settlement.approve"
  | "settlement.reject"
  | "funder.add"
  | "funder.remove"
  | "user.suspend"
  | "user.unsuspend"
  | "user.promote"
  | "user.demote"
  | "user.rename"
  | "report.resolve"
  | "referral.pay"
  | "user.super_admin"
  | "user.super_admin_remove"
  | "wheel.pause"
  | "wheel.resume"
  | "wheel.liquidity"
  | "category.add"
  | "category.remove"
  | "churn.run";

export interface AuditEvent {
  /** Null for system jobs. */
  actorId: string | null;
  action: AuditAction;
  targetType?: "proposal" | "settlement" | "wheel" | "user" | "funder" | "outcome" | "report" | "category";
  targetId?: string;
  details?: Record<string, unknown>;
}

/** Append to the audit log. Pass the action's transaction so both commit together. */
export async function logEvent(db: AnyDb | Tx, e: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    details: e.details ?? {},
  });
}
