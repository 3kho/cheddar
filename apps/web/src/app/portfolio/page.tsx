import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { CheeseIcon, SparklesIcon } from "@/components/Icons";
import { Avatar, WheelIcon } from "@/components/Logo";
import { ValueChart } from "@/components/ValueChart";
import { cancelOrderAction, syncNowAction } from "@/lib/actions";
import { formatDate, formatLatta, formatShares, timeAgo } from "@/lib/format";
import { cashHistory, costBasis, portfolio, settledHistory, userStats } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio · Cheddar" };

const KIND_LABEL: Record<string, string> = {
  churn: "Churn",
  order_lock: "Order placed",
  order_release: "Order released",
  trade: "Trade",
  payout: "Payout",
  moldy_refund: "Moldy refund",
  mouse_sweep: "Sent to The Mouse",
};

const TABS = [
  ["positions", "Positions"],
  ["orders", "Open orders"],
  ["activity", "Activity"],
] as const;

type SP = { churn?: string; ticks?: string; tab?: string; view?: string };

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("/portfolio");
  const sp = await searchParams;
  // Old links used ?tab=history; that's now the Closed view of Positions.
  const tab = sp.tab === "history" ? "positions" : TABS.some(([k]) => k === sp.tab) ? sp.tab! : "positions";
  const view = sp.tab === "history" || sp.view === "closed" ? "closed" : "active";
  const [p, basis, history, stats, cash] = await Promise.all([
    portfolio(user.id),
    costBasis(user.id),
    settledHistory(user.id),
    userStats(user.id),
    cashHistory(user.id),
  ]);

  // One row per (wedge, outcome) held, valued at the current chance.
  const rows = p.positions.flatMap((x) =>
    (["YES", "NO"] as const)
      .map((o) => {
        const shares = o === "YES" ? x.p.yesShares : x.p.noShares;
        if (!shares) return null;
        const b = basis.get(`${x.wedge.id}:${o}`);
        const avg = b && b.bought ? b.cost / b.bought : null;
        const now = x.chance == null ? null : o === "YES" ? x.chance : 100 - x.chance;
        const value = now == null ? null : shares * now;
        const cost = avg == null ? null : Math.round(shares * avg);
        return { x, o, shares, avg, now, value, pnl: value != null && cost != null ? value - cost : null, cost };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  );
  const positionsValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const openPnl = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const realised = history.reduce((s, h) => s + h.net, 0);
  const biggestWin = history.reduce((m, h) => Math.max(m, h.net), 0);
  const counts: Record<string, number> = { positions: rows.length, orders: p.orders.length };
  const pnlTone = (v: number) => (v > 0 ? "text-yes" : v < 0 ? "text-no" : "");

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      {sp.churn === "credited" && (
        <div className="rounded-xl border border-yes/40 bg-yes-soft p-4 text-sm">
          <SparklesIcon size={15} className="mr-1.5 inline-block align-[-3px] text-yes" />
          Hackatime linked! <strong>{formatLatta(Number(sp.ticks ?? 0))}</strong> churned from your coding hours.
        </div>
      )}
      {sp.churn && sp.churn !== "credited" && (
        <div className="rounded-xl bg-surface-2 p-4 text-sm">
          Hackatime linked.{" "}
          {sp.churn === "skipped_untrusted"
            ? "Hackatime has flagged this account, so Churn is paused."
            : sp.churn === "error"
              ? "We couldn't read your hours just now; we'll try again soon."
              : "No new hours to churn yet."}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-line bg-surface p-4">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4">
            <Avatar slackId={user.slackId} name={user.name} size={64} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.015em]">{user.name ?? "Hack Clubber"}</h1>
              <p className="text-sm text-muted">
                {stats.joined ? `Joined ${stats.joined.toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : "Hack Clubber"}
                {user.isCheesemonger && (
                  <span className="ml-1 inline-flex items-center gap-1 align-[-2px]">
                    · <CheeseIcon size={13} className="text-accent" /> Cheesemonger
                  </span>
                )}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-3 border-t border-line text-center">
            <Stat label="Positions value" value={formatLatta(positionsValue)} />
            <Stat label="Biggest win" value={biggestWin ? formatLatta(biggestWin) : "—"} />
            <Stat label="Wheels traded" value={String(stats.wheelsTraded)} />
          </dl>
          <dl className="text-xs">
            <Row label="Cash">
              {formatLatta(p.balances.available)}
              {p.balances.locked > 0 && <span className="font-normal text-muted"> + {formatLatta(p.balances.locked)} in orders</span>}
            </Row>
            <Row label="Open P&L">
              <span className={pnlTone(openPnl)}>{rows.length ? formatLatta(openPnl, { sign: true }) : "—"}</span>
            </Row>
            <Row label="Realised P&L">
              <span className={pnlTone(realised)}>{history.length ? formatLatta(realised, { sign: true }) : "—"}</span>
            </Row>
            <Row label="Total volume">{stats.volumeTicks ? formatLatta(stats.volumeTicks) : "—"}</Row>
          </dl>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] max-md:mt-3 md:mt-3">
            <span className="text-muted">
              <CheeseIcon size={14} className="mr-1 inline-block align-[-2px] text-accent" />
              Churn
              {user.isMouseFunder ? (
                ": your hours feed The Mouse"
              ) : user.hackatimeUserId ? (
                <>
                  : <strong className="tabular text-ink">{formatLatta(p.churnEarnedTicks)}</strong> earned
                  {p.lastSync ? ` · synced ${timeAgo(p.lastSync.fetchedAt)}` : ""}
                </>
              ) : (
                ": link Hackatime to earn Latta Cheese from coding"
              )}
            </span>
            {!user.isMouseFunder &&
              (user.hackatimeUserId ? (
                <ActionButton action={syncNowAction} className="font-semibold text-ink hover:underline">
                  Sync now
                </ActionButton>
              ) : (
                <a href="/api/hackatime/start" className="rounded-[10px] bg-primary px-3 py-1 font-semibold text-white hover:bg-primary-hover">
                  Link Hackatime
                </a>
              ))}
          </div>
        </section>

        <section className="min-h-[225px] rounded-xl border border-line bg-surface p-4">
          <ValueChart points={cash} now={Date.now()} current={p.balances.available + p.balances.locked} label="Cash balance" />
        </section>
      </div>

      <div className="pt-4">
        <nav className="flex gap-5 border-b border-line" aria-label="Portfolio sections">
          {TABS.map(([k, label]) => (
            <Link
              key={k}
              href={`/portfolio?tab=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={`relative flex shrink-0 items-center gap-1.5 pb-3 text-base font-semibold transition-colors ${
                tab === k ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
              {counts[k] ? <span className="tabular rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{counts[k]}</span> : null}
              {tab === k && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
            </Link>
          ))}
        </nav>

        <div className="pt-4">
          {tab === "positions" && (
            <>
              <div className="mb-3 inline-flex rounded-[12px] border border-line p-1">
                {(["active", "closed"] as const).map((v) => (
                  <Link
                    key={v}
                    href={`/portfolio?tab=positions${v === "closed" ? "&view=closed" : ""}`}
                    aria-current={view === v ? "page" : undefined}
                    className={`flex h-8 items-center rounded-[10px] px-3.5 text-sm font-semibold transition-colors ${
                      view === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {v === "active" ? "Active" : "Closed"}
                    <span className="tabular ml-1.5 text-xs text-muted">{v === "active" ? rows.length : history.length}</span>
                  </Link>
                ))}
              </div>

              {view === "active" ? (
                rows.length === 0 ? (
                  <Empty>
                    No positions yet.{" "}
                    <Link href="/" className="font-semibold text-ink underline underline-offset-2">
                      Find a wheel
                    </Link>{" "}
                    you know something about.
                  </Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-muted">
                        <tr className="border-b border-line">
                          <th className="py-3 pr-4 font-medium">Market</th>
                          <th className="px-4 py-3 text-right font-medium">Avg</th>
                          <th className="px-4 py-3 text-right font-medium">Current</th>
                          <th className="py-3 pl-4 text-right font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${r.x.wedge.id}:${r.o}`} className="border-b border-line last:border-0 hover:bg-hover">
                            <td className="py-3 pr-4">
                              <Link href={`/wheel/${r.x.wheel.slug}?w=${r.x.wedge.id}&o=${r.o}`} className="flex items-center gap-3">
                                <WheelIcon icon={r.x.wheel.icon} category={r.x.wheel.category} size={40} />
                                <span className="min-w-0">
                                  <span className="line-clamp-1 font-medium hover:underline">{r.x.wheel.title}</span>
                                  <span className="text-xs">
                                    <span className={`rounded px-1.5 py-px font-semibold ${r.o === "YES" ? "bg-yes-soft text-yes" : "bg-no-soft text-no"}`}>
                                      {r.o === "YES" ? "Yes" : "No"}
                                      {r.avg != null && ` ${r.avg.toFixed(0)}¢`}
                                    </span>
                                    {r.x.wedge.label !== "Yes" && <span className="text-muted"> · {r.x.wedge.label}</span>}
                                    <span className="tabular text-muted"> · {formatShares(r.shares)} shares</span>
                                  </span>
                                </span>
                              </Link>
                            </td>
                            <td className="tabular px-4 py-3 text-right text-muted">{r.avg == null ? "—" : `${r.avg.toFixed(1)}¢`}</td>
                            <td className="tabular px-4 py-3 text-right">{r.now == null ? "—" : `${r.now}¢`}</td>
                            <td className="tabular py-3 pl-4 text-right">
                              <div className="font-semibold">{r.value == null ? "—" : formatLatta(r.value)}</div>
                              {r.pnl != null && (
                                <div className={`text-xs ${pnlTone(r.pnl)}`}>
                                  {formatLatta(r.pnl, { sign: true })}
                                  {r.cost ? ` (${((r.pnl / r.cost) * 100).toFixed(1)}%)` : ""}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : history.length === 0 ? (
                <Empty>Nothing closed yet. Wheels you traded show up here once they ripen, win or lose.</Empty>
              ) : (
                <ul>
                  {history.map((h) => {
                    const won = h.status === "resolved_yes" ? "Yes" : h.status === "resolved_no" ? "No" : null;
                    return (
                      <li key={h.wedge_id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                        <Link href={`/wheel/${h.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <WheelIcon icon={h.icon} category={h.category} size={40} />
                          <span className="min-w-0">
                            <span className="line-clamp-1 font-medium hover:underline">{h.title}</span>
                            <span className="text-xs text-muted">
                              {h.label !== "Yes" && `${h.label} · `}
                              {won ? `Resolved ${won}` : "Moldy"}
                              {h.resolved_at && ` · ${formatDate(h.resolved_at)}`}
                              {h.paid > 0 && ` · paid ${formatLatta(h.paid)}`}
                            </span>
                          </span>
                        </Link>
                        <span className={`tabular shrink-0 font-semibold ${h.net > 0 ? "text-yes" : h.net < 0 ? "text-no" : "text-muted"}`}>
                          {h.net > 0 ? "Won " : h.net < 0 ? "Lost " : ""}
                          {formatLatta(Math.abs(h.net))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {tab === "orders" &&
            (p.orders.length === 0 ? (
              <Empty>No open orders.</Empty>
            ) : (
              <ul className="text-sm">
                {p.orders.map(({ o, wedge, wheel }) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                    <Link href={`/wheel/${wheel.slug}?w=${wedge.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <WheelIcon icon={wheel.icon} category={wheel.category} size={40} />
                      <span className="min-w-0 truncate font-medium hover:underline">
                        {wheel.title}
                        {wedge.label !== "Yes" && <span className="text-muted"> · {wedge.label}</span>}
                      </span>
                    </Link>
                    <span className="tabular text-muted">
                      <span className={`font-semibold ${o.side === "BUY" ? "text-yes" : "text-no"}`}>{o.side === "BUY" ? "Buy" : "Sell"}</span>{" "}
                      {o.outcome === "YES" ? "Yes" : "No"} · {formatShares(o.remaining)} @ {o.price}¢
                    </span>
                    <ActionButton action={cancelOrderAction.bind(null, o.id)} className="text-xs font-semibold text-no hover:underline">
                      Cancel
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "activity" &&
            (p.activity.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="text-sm">
                {p.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                    <div className="min-w-0">
                      <div className="font-medium">{KIND_LABEL[a.kind] ?? a.kind}</div>
                      {a.wheelTitle && (
                        <Link href={`/wheel/${a.wheelSlug}`} className="block truncate text-xs text-muted hover:underline">
                          {a.wheelTitle}
                          {a.wedgeLabel && a.wedgeLabel !== "Yes" ? ` · ${a.wedgeLabel}` : ""}
                        </Link>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={`tabular font-semibold ${a.amount > 0 ? "text-yes" : ""}`}>{formatLatta(a.amount, { sign: true })}</div>
                      <div className="text-xs text-muted">{timeAgo(a.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse px-1 py-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="tabular truncate text-lg font-medium">{value}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-12 text-center text-sm text-muted">{children}</p>;
}
