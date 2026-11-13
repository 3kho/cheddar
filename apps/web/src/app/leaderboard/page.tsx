import Link from "next/link";
import { Avatar } from "@/components/Logo";
import { formatLatta } from "@/lib/format";
import { biggestWins, leaderboardStats, type LeaderMetric, type LeaderPeriod } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard · Cheddar" };

const PERIODS: { key: LeaderPeriod; label: string; win: string }[] = [
  { key: "day", label: "Today", win: "today" },
  { key: "week", label: "Weekly", win: "this week" },
  { key: "month", label: "Monthly", win: "this month" },
  { key: "all", label: "All", win: "of all time" },
];
const METRICS: { key: LeaderMetric; label: string; width: string }[] = [
  { key: "profit", label: "Profit/Loss", width: "min-w-20" },
  { key: "volume", label: "Volume", width: "min-w-[100px]" },
];
const MEDALS = ["#E1A610", "#96ABB4", "#BD7F6F"];

/** Rosette for ranks 1–3, tucked under the avatar's corner. */
function Medal({ rank }: { rank: number }) {
  const color = MEDALS[rank - 1]!;
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" className="absolute -bottom-1.5 -left-2" aria-label={`Rank ${rank}`}>
      <path d="M5 14 2 25l5-2.5 3 3.5 1-10Zm12 0 3 11-5-2.5-3 3.5-1-10Z" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
      <circle cx="11" cy="9.5" r="8" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
      <text x="11" y="13" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
        {rank}
      </text>
    </svg>
  );
}

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ p?: string; m?: string }> }) {
  const sp = await searchParams;
  const period = PERIODS.find((x) => x.key === sp.p) ?? PERIODS[2]!;
  const metric = METRICS.find((x) => x.key === sp.m)?.key ?? "profit";
  const [rows, wins, me] = await Promise.all([leaderboardStats(metric, period.key), biggestWins(period.key), currentUser()]);
  const href = (p: LeaderPeriod, m: LeaderMetric) => `/leaderboard?p=${p}&m=${m}`;
  const onBoard = !!me && rows.some((r) => r.id === me.id);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0">
        <h1 className="text-[32px] font-semibold leading-9 tracking-[-0.01em]">Leaderboard</h1>
        <p className="mt-1.5 text-sm text-muted">
          Profit counts wheels that ripened in the period: payouts, plus what you paid and got for your trades on them.
        </p>

        <nav className="mt-6 inline-flex h-10 overflow-hidden rounded-md border border-line" aria-label="Period">
          {PERIODS.map((x) => (
            <Link
              key={x.key}
              href={href(x.key, metric)}
              aria-current={x.key === period.key ? "page" : undefined}
              className={`flex h-full items-center border-l border-line px-4 text-sm font-semibold transition-colors first:border-l-0 ${
                x.key === period.key ? "bg-surface-2 text-ink" : "text-muted hover:bg-hover hover:text-ink"
              }`}
            >
              {x.label}
            </Link>
          ))}
        </nav>

        <div className="mt-5 flex items-center justify-between gap-4 border-y border-line">
          <span className="py-3 text-sm font-medium text-muted">Hack Clubbers</span>
          <div className="flex items-center gap-4 self-stretch text-sm font-medium">
            {METRICS.map((x, i) => (
              <span key={x.key} className={`flex items-stretch gap-4`}>
                {i > 0 && <span className="my-auto h-5 w-0.5 rounded-full bg-surface-3" aria-hidden="true" />}
                <Link
                  href={href(period.key, x.key)}
                  aria-current={x.key === metric ? "page" : undefined}
                  className={`relative flex items-center justify-end ${x.width} ${x.key === metric ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  {x.label}
                  {x.key === metric && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
                </Link>
              </span>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">Nobody yet {period.win}. Go make a trade!</p>
        ) : (
          <ol>
            {rows.map((r, i) => {
              const isMe = me?.id === r.id;
              return (
                <li key={r.id} className={`flex items-center gap-3 border-b border-line py-5 ${isMe ? "bg-accent-soft/60" : ""}`}>
                  <span className="tabular min-w-8 text-sm font-medium text-muted">{i + 1}</span>
                  <span className="relative shrink-0">
                    <span className="block rounded-full border border-line">
                      <Avatar slackId={r.slackId} name={r.name} size={40} />
                    </span>
                    {i < 3 && <Medal rank={i + 1} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {r.name ?? "Hack Clubber"}
                    {isMe && <span className="ml-1.5 text-sm text-muted">(you)</span>}
                  </span>
                  <span className={`tabular min-w-20 text-right text-sm font-medium ${metric === "volume" ? "text-muted max-sm:hidden" : ""}`}>
                    {formatLatta(r.profit, { sign: true })}
                  </span>
                  <span
                    className={`tabular min-w-[100px] text-right ${
                      metric === "volume" ? "text-sm font-medium" : "text-[13px] font-medium text-muted max-sm:hidden"
                    }`}
                  >
                    {formatLatta(r.volume, { compact: true })}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {me && !onBoard && rows.length > 0 && <p className="mt-3 text-sm text-muted">You&apos;re not on the board {period.win} yet.</p>}
      </section>

      <aside className="lg:sticky lg:top-[129px] lg:self-start">
        <div className="flex max-h-[600px] flex-col overflow-hidden rounded-2xl bg-surface shadow-mid">
          <h2 className="px-5 pb-2 pt-5 text-xl font-semibold tracking-[-0.01em]">Biggest wins {period.win}</h2>
          {wins.length === 0 ? (
            <p className="px-5 pb-8 pt-4 text-sm text-muted">No wheels ripened {period.win}.</p>
          ) : (
            <ol className="overflow-y-auto px-5 pb-2">
              {wins.map((w, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-line py-4 last:border-0">
                  <span className="tabular min-w-5 text-xs font-medium text-muted">{i + 1}</span>
                  <Avatar slackId={w.slack_id} name={w.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="max-w-[40%] shrink-0 truncate font-semibold">{w.name ?? "Hack Clubber"}</span>
                      <span className="h-3 w-0.5 shrink-0 rounded-full bg-surface-3" aria-hidden="true" />
                      <Link href={`/wheel/${w.slug}`} className="truncate font-medium text-muted hover:underline">
                        {w.title}
                      </Link>
                    </div>
                    <div className="tabular text-[13px]">
                      {formatLatta(w.spent)} <span className="text-faint">→</span> <span className="font-medium text-yes">{formatLatta(w.got)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
