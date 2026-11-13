import { eq, users, type Tx } from "@cheddar/db";
import { ExchangeError } from "./errors";

export interface ReviewOptions {
  now?: () => Date;
  /**
   * Let a Cheesemonger approve or reject their own proposal or settlement.
   * Off by default (another Cheesemonger has to review). Turn on while there is only one.
   */
  allowSelfReview?: boolean;
}

export async function assertReviewer(tx: Tx, reviewerId: string, authorId: string, opts: ReviewOptions) {
  const [u] = await tx.select({ isCheesemonger: users.isCheesemonger }).from(users).where(eq(users.id, reviewerId));
  if (!u?.isCheesemonger) throw new ExchangeError("FORBIDDEN", "only Cheesemongers can review");
  if (!opts.allowSelfReview && reviewerId === authorId) {
    throw new ExchangeError("FORBIDDEN", "another Cheesemonger has to review this");
  }
}

export function requireText(value: string | undefined, field: string, max: number): string {
  const v = (value ?? "").trim();
  if (!v) throw new ExchangeError("INVALID", `${field} is required`);
  if (v.length > max) throw new ExchangeError("INVALID", `${field} must be at most ${max} characters`);
  return v;
}
