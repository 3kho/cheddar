import Link from "next/link";
import type { HackatimeStatus } from "@/lib/accounts";
import type { SessionUser } from "@/lib/session";
import { CheckIcon } from "./Icons";

interface State {
  traded: boolean;
  cash: number;
  invited: boolean;
}

/** A short checklist for people who haven't traded yet. Disappears after their first trade. */
export function GettingStarted({ user, state, status }: { user: SessionUser; state: State | null; status: HackatimeStatus | null }) {
  if (!state) return null;
  const steps: { done: boolean; title: string; body: React.ReactNode }[] = [
    {
      done: state.cash > 0,
      title: "Code with Hackatime",
      body: (
        <>
          Latta Cheese is how you trade, and you earn <strong>10 Lc for every hour of non-AI coding</strong> on Hackatime. We find your hours
          through your Slack account, so there&apos;s nothing to link.
          {status === "private" && (
            <>
              {" "}
              <strong>Your Hackatime stats are private, so we can&apos;t see them yet.</strong>{" "}
              <a href="https://hackatime.hackclub.com/my/settings" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                Make them public
              </a>{" "}
              or{" "}
              <a href="/api/hackatime/start" className="font-semibold underline underline-offset-2">
                link your account
              </a>
              .
            </>
          )}
          {(status === "not_found" || status === "no_slack") && (
            <>
              {" "}
              <a href="/api/hackatime/start" className="font-semibold underline underline-offset-2">
                Link your Hackatime account
              </a>{" "}
              if you already code with it.
            </>
          )}
        </>
      ),
    },
    {
      done: user.hasAcceptedFairPlay,
      title: "Agree to play fair",
      body: (
        <>
          No insider trading, no alts.{" "}
          {!user.hasAcceptedFairPlay && (
            <Link href="/welcome" className="font-semibold underline underline-offset-2">
              Read and accept
            </Link>
          )}
        </>
      ),
    },
    {
      done: state.traded,
      title: "Make your first trade",
      body: "Pick a wheel below, choose Yes or No, and buy a few shares. A share pays 1 Lc if you're right and 0 if you're wrong, so the price is the chance.",
    },
    {
      done: state.invited,
      title: "Invite a friend",
      body: (
        <>
          You both get a bonus when they make their first trade.{" "}
          <Link href="/refer" className="font-semibold underline underline-offset-2">
            Get your link
          </Link>
        </>
      ),
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="mb-8 rounded-2xl bg-accent-soft p-5" aria-label="Getting started">
      <h2 className="text-base font-semibold">Getting started</h2>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className={`flex items-start gap-3 ${s.done ? "opacity-60" : ""}`}>
            <span
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                s.done ? "bg-yes-solid text-white" : i === next ? "bg-ink text-bg" : "bg-surface-3 text-muted"
              }`}
              aria-hidden="true"
            >
              {s.done ? <CheckIcon size={12} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 text-sm">
              <div className={`font-semibold ${s.done ? "line-through" : ""}`}>{s.title}</div>
              {!s.done && <p className="mt-0.5 text-muted">{s.body}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
