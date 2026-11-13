/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Serverless instances don't live long enough for timers: /api/cron/* do this work instead.
  if (process.env.VERCEL) return;
  const { startChurnScheduler } = await import("./lib/churn-job");
  startChurnScheduler();
  const { startMouseScheduler } = await import("./lib/mouse-job");
  startMouseScheduler();
}
