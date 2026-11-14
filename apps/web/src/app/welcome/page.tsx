import { redirect } from "next/navigation";
import { FairPlayForm } from "@/components/FairPlayForm";
import { safeReturnTo } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fair play · Cheddar" };

const RULES: [string, string][] = [
  [
    "No insider trading",
    "Don't trade on information the public doesn't have, like a decision you've seen early, a result you already know, or anything you only know because of your role or access.",
  ],
  [
    "Don't rig the outcome",
    "Don't trade on something you control, and don't make an outcome happen (or stop it happening) just to win a market.",
  ],
  [
    "One person, one account",
    "No alt accounts, and no trading back and forth with friends to move prices or farm the leaderboard.",
  ],
  [
    "Latta Cheese is play money",
    "It has no cash value and can't be bought, sold or withdrawn. Don't trade it for anything outside Cheddar.",
  ],
];

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const next = safeReturnTo(returnTo);
  const user = await requireUser("/welcome");
  if (user.hasAcceptedFairPlay) redirect(next);
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Play fair</h1>
      <p className="mt-1.5 text-sm text-muted">
        Cheddar is a game for the Hack Club community, and it only works if everyone plays fair. Before you start trading:
      </p>
      <ul className="my-6 space-y-3">
        {RULES.map(([title, body]) => (
          <li key={title} className="rounded-xl bg-surface p-4 shadow-mid">
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-0.5 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ul>
      <p className="mb-5 text-sm text-muted">
        Break these rules and the Cheesemongers can void your trades, remove your Latta Cheese, and suspend or ban your account.
      </p>
      <FairPlayForm returnTo={next} />
    </div>
  );
}
