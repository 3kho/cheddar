import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Logo";
import { ReportButton } from "@/components/ReportButton";
import { formatDate, formatLatta } from "@/lib/format";
import { userProfile } from "@/lib/profile";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await userProfile((await params).id);
  return { title: p ? `${p.name ?? "Hack Clubber"} · Cheddar` : "Cheddar" };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, me] = await Promise.all([userProfile(id), currentUser()]);
  if (!p) notFound();
  const isMe = me?.id === p.id;
  const winRate = p.settledCount ? Math.round((p.winCount / p.settledCount) * 100) : null;
  const stat = (label: string, value: string, tone = "") => (
    <div className="rounded-xl bg-surface p-4 shadow-mid">
      <div className="text-xs text-muted">{label}</div>
      <div className={`tabular mt-0.5 text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar slackId={p.slackId} name={p.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{p.name ?? "Hack Clubber"}</h1>
          <p className="text-sm text-muted">
            Joined {formatDate(p.createdAt)}
            {p.isCheesemonger && " · Cheesemonger"}
            {p.isSuspended && " · Suspended"}
          </p>
        </div>
        {isMe ? (
          <Link href="/profile" className="rounded-[10px] bg-surface-2 px-3 py-2 text-sm font-semibold text-muted hover:bg-hover hover:text-ink">
            Edit profile
          </Link>
        ) : (
          me && !me.isSuspended && <ReportButton targetType="user" targetId={p.id} label="Report name" />
        )}
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Stats">
        {stat("Profit / loss", formatLatta(p.profit, { sign: true }), p.profit > 0 ? "text-yes" : p.profit < 0 ? "text-no" : "")}
        {stat("Volume", formatLatta(p.volume, { compact: true }))}
        {stat("Wheels traded", String(p.wheelsTraded))}
        {stat("Win rate", winRate === null ? "–" : `${winRate}%`)}
      </section>
      <p className="mt-2 text-xs text-muted">
        Profit and win rate count wheels that have ripened{p.settledCount ? ` (${p.winCount} of ${p.settledCount} in profit)` : ""}.
      </p>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Holding now</h2>
        {!p.positions.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No open positions.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl bg-surface shadow-mid">
            {p.positions.map((x, i) => (
              <li key={`${x.wheelSlug}-${x.label}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/wheel/${x.wheelSlug}`} className="min-w-0 truncate font-medium hover:underline">
                  {x.wheelTitle}
                  <span className="text-muted"> · {x.label}</span>
                </Link>
                <span className="tabular shrink-0 text-muted">
                  {x.yes > 0 && <span className="text-yes">{x.yes} Yes</span>}
                  {x.yes > 0 && x.no > 0 && " · "}
                  {x.no > 0 && <span className="text-no">{x.no} No</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Recent trades</h2>
        {!p.recent.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No trades yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl bg-surface shadow-mid">
            {p.recent.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/wheel/${x.wheelSlug}`} className="min-w-0 truncate hover:underline">
                  <span className="font-medium">{x.shares > 0 ? "Bought" : "Sold"}</span> {Math.abs(x.shares)} {x.outcome === "YES" ? "Yes" : "No"}
                  <span className="text-muted">
                    {" "}
                    · {x.wheelTitle}
                    {x.label !== "Yes" && x.label !== "No" ? ` · ${x.label}` : ""}
                  </span>
                </Link>
                <span className="tabular shrink-0 text-xs text-muted">{formatDate(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
