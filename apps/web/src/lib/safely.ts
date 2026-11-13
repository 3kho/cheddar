import type { ActionResult } from "./actions";

/**
 * Await a server action from the client without letting a failed request (network blip, timed-out
 * or restarted serverless function, a deploy in between) throw into React and blank the page.
 */
export async function safely(call: Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await call;
  } catch (e) {
    console.error(e);
    const stale = e instanceof Error && /Server Action|failed-to-find/i.test(e.message);
    return {
      ok: false,
      error: stale
        ? "Cheddar was just updated. Reload the page and try again."
        : "Couldn't reach Cheddar. Check whether it went through, then try again.",
    };
  }
}
