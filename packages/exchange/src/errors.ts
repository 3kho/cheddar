import type { AnyDb, Tx } from "@cheddar/db";

export type ExchangeErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SHARES"
  | "MARKET_CLOSED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID";

/** Expected, user-facing failures. Anything else is a bug or an infrastructure error. */
export class ExchangeError extends Error {
  constructor(
    readonly code: ExchangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExchangeError";
  }
}

/** Run `fn` in a transaction, retrying on deadlock / serialization failure. */
export async function runTx<T>(db: AnyDb, fn: (tx: Tx) => Promise<T>, maxRetries = 8): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (e) {
      if (attempt < maxRetries && isRetryable(e)) continue;
      throw e;
    }
  }
}

/** Postgres serialization failure / deadlock: safe to retry the whole transaction. */
export function isRetryable(e: unknown): boolean {
  for (let cur: unknown = e; cur && typeof cur === "object"; cur = (cur as { cause?: unknown }).cause) {
    const code = (cur as { code?: unknown }).code;
    if (code === "40001" || code === "40P01") return true;
  }
  return false;
}
