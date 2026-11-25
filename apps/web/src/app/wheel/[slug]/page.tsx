import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { ReasonAction } from "@/components/ActionButton";
import { ReportButton } from "@/components/ReportButton";
import { ShareButton } from "@/components/ShareButton";
import { ensureReferralCode } from "@cheddar/exchange";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { inviteUrl } from "@/lib/referral";
import { Change, CheeseIcon, ClockIcon, ListPlusIcon, MoldIcon, MouseIcon, PauseIcon, PencilIcon, ShieldIcon, TickIcon } from "@/components/Icons";
import { LinkedActions } from "@/components/LinkedActions";
import { Linkified } from "@/components/Linkified";
import { Avatar, WheelIcon } from "@/components/Logo";
import { OrderBookView } from "@/components/OrderBookView";
import { PositionCard, type PositionLine } from "@/components/PositionCard";
import { PriceChart, type Series } from "@/components/PriceChart";
import { SettleForm } from "@/components/SettleForm";
import { SuggestOutcome } from "@/components/SuggestOutcome";
import { Tabs } from "@/components/Tabs";
import { TradePanel, type TradeWedge } from "@/components/TradePanel";
import { WheelStatus, resolvedLabel } from "@/components/WheelCard";
import { cancelOrderAction, haltPassedDateWedgesAction, haltWedgeAction, undoTradeAction } from "@/lib/actions";
import { formatChance, formatDate, formatDateEst, formatLatta, formatShares, timeAgo } from "@/lib/format";
import { bestPrice } from "@/lib/market";
import {
  balancesOf,
  costBasis,
  getWheel,
  listWheels,
  topHolders,
  userMarketState,
  wheelActivity,
  wheelOutcomeRequests,
} from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getWheel((await params).slug);
  if (!data) return { title: "Cheddar" };
  const blurb = (data.wheel.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const description = blurb || `Trade on “${data.wheel.title}” with Latta Cheese on Cheddar, Hack Club's play-money prediction market.`;
  return {
    title: `${data.wheel.title} · Cheddar`,
    description,
    // The card image comes from this folder's opengraph-image.tsx (the wheel's own picture).
    openGraph: { title: data.wheel.title, description },
    twitter: { card: "summary_large_image" as const, title: data.wheel.title, description },
  };
}

/** Colours for the two sides of a 2-outcome wheel. */
const PAIR = ["var(--chart-1)", "var(--chart-4)"];

export default async function WheelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ w?: string; o?: string }>;
}) {
  const [{ slug }, sp, user] = await Promise.all([params, searchParams, currentUser()]);
  let data = await getWheel(slug);
  if (!data) notFound();
  let { wheel, depth, history, settlement, creatorName, settlementBy, settlementProposedBy } = data;
  // On date markets, auto-halt any options whose date has passed, then refresh.
  if (wheel.marketType === "date" && wheel.status === "open") {
    await haltPassedDateWedgesAction(wheel.id);
    data = await getWheel(slug);
    if (!data) notFound();
    ({ wheel, depth, history, settlement, creatorName, settlementBy, settlementProposedBy } = data);
  }
  // On date markets, auto-halt any options whose date has passed.
  if (wheel.marketType === "date" && wheel.status === "open") {
    await haltPassedDateWedgesAction(wheel.id);
  }
  // Logged-in people share a link that signs new people up as their invites.
  const shareUrl = user ? inviteUrl(await ensureReferralCode(await getDb(), user.id), `/wheel/${wheel.slug}`) : `${env.appUrl}/wheel/${wheel.slug}`;
  const binary = wheel.wedges.length === 1;
  const pair = wheel.wedges.length === 2;
  const done = wheel.status === "resolved" || wheel.status === "moldy";
  const sorted = binary || pair ? wheel.wedges : [...wheel.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
  const selected = wheel.wedges.find((w) => w.id === sp.w) ?? sorted[0]!;
  const outcome = sp.o === "NO" ? "NO" : "YES";
  const ids = wheel.wedges.map((w) => w.id);

  const takesSuggestions = wheel.allowAdditions && !binary && wheel.status === "open";
  const [mine, bal, activity, holders, related, basis, suggestions] = await Promise.all([
    user ? userMarketState(user.id, ids) : Promise.resolve({ positions: [], orders: [] }),
    user ? balancesOf(user.id) : Promise.resolve({ available: 0, locked: 0 }),
    wheelActivity(ids),
    topHolders(selected.id),
    listWheels({ category: wheel.category ?? undefined, excludeId: wheel.id, limit: 5 }),
    user ? costBasis(user.id) : Promise.resolve(new Map<string, { bought: number; cost: number }>()),
    takesSuggestions ? wheelOutcomeRequests(wheel.id) : Promise.resolve([]),
  ]);
  /** Cost of the shares still held, at the average buy price. */
  const heldCost = (wedgeId: string, o: "YES" | "NO", shares: number) => {
    const b = basis.get(`${wedgeId}:${o}`);
    return b && b.bought ? Math.round((shares * b.cost) / b.bought) : 0;
  };
  const pos = new Map(mine.positions.map((p) => [p.wedgeId, p]));
  const labelOf = (id: string | null) => wheel.wedges.find((w) => w.id === id)?.label ?? "";

  const positionLines: PositionLine[] = [];
  const tradeWedges: TradeWedge[] = wheel.wedges.map((w) => {
    const p = pos.get(w.id);
    return {
      id: w.id,
      label: w.label,
      depth: depth.get(w.id) ?? { bids: [], asks: [] },
      freeYes: p ? p.yesShares - p.yesLocked : 0,
      freeNo: p ? p.noShares - p.noLocked : 0,
      heldYes: p?.yesShares ?? 0,
      heldNo: p?.noShares ?? 0,
      costYes: heldCost(w.id, "YES", p?.yesShares ?? 0),
      costNo: heldCost(w.id, "NO", p?.noShares ?? 0),
    };
  });
  for (const t of tradeWedges) {
    const chance = wheel.wedges.find((w) => w.id === t.id)?.chance ?? null;
    const prefix = binary ? "" : `${t.label} · `;
    if (t.heldYes > 0) {
      positionLines.push({
        key: `${t.id}:YES`,
        label: `${prefix}Yes`,
        shares: t.heldYes,
        investedTicks: t.costYes,
        valueTicks: chance == null ? null : t.heldYes * chance,
      });
    }
    if (t.heldNo > 0) {
      positionLines.push({
        key: `${t.id}:NO`,
        label: `${prefix}No`,
        shares: t.heldNo,
        investedTicks: t.costNo,
        valueTicks: chance == null ? null : t.heldNo * (100 - chance),
      });
    }
  }

  const tradable = wheel.status === "open" && (!wheel.closesAt || wheel.closesAt > new Date());
  const gate = !user
    ? { reason: "Log in with Hack Club to trade.", href: `/api/auth/login?returnTo=/wheel/${slug}`, cta: "Log in to trade" }
    : user.isSuspended
      ? { reason: "Your account is suspended.", cta: "Suspended" }
      : user.isMouseFunder
        ? { reason: "Mouse funders can browse but not trade.", cta: "Feeding The Mouse", icon: <MouseIcon size={18} /> }
        : wheel.tradingPausedAt
          ? {
              reason: wheel.pauseReason ? `Paused by the Cheesemongers: ${wheel.pauseReason}` : "Paused by the Cheesemongers.",
              cta: "Trading paused",
              icon: <PauseIcon size={16} />,
            }
          : wheel.status === "ripening"
            ? { reason: "Trading is paused while the Cheesemongers review a request to close this wheel.", cta: "Ripening", icon: <CheeseIcon size={18} /> }
            : done
              ? {
                  reason: "This wheel has ripened. Payouts are in everyone's cash.",
                  cta: resolvedLabel(wheel) ?? "Resolved",
                  icon: wheel.status === "moldy" ? <MoldIcon size={18} /> : <TickIcon size={16} strokeWidth={2.6} />,
                }
              : !tradable
                ? { reason: "This wheel is closed.", cta: "Closed" }
                : null;

  const now = Date.now();
  const series: Series[] = (binary || pair ? sorted : sorted.slice(0, 4)).map((w) => ({
    label: w.label,
    chance: w.chance,
    points: history.filter((h) => h.wedgeId === w.id).map((h) => ({ t: h.at.getTime(), p: h.yesPrice })),
  }));

  const canSettle =
    !!user && !user.isSuspended && (user.id === wheel.creatorId || user.isCheesemonger) && (wheel.status === "open" || wheel.status === "closed");
  const selectedDepth = depth.get(selected.id) ?? { bids: [], asks: [] };
  const buyYes = bestPrice(selectedDepth, "YES", "BUY");
  const buyNo = bestPrice(selectedDepth, "NO", "BUY");

  const outcomeName = (o: "YES" | "NO") => (o === "YES" ? "Yes" : "No");
  const youHold = (wedgeId: string) => {
    const p = pos.get(wedgeId);
    if (!p || (p.yesShares <= 0 && p.noShares <= 0)) return null;
    return (
      <span className="ml-1.5 inline-flex gap-1 align-middle">
        {p.yesShares > 0 && <span className="rounded bg-yes-soft px-1.5 text-[11px] font-semibold text-yes">{formatShares(p.yesShares)} Yes</span>}
        {p.noShares > 0 && <span className="rounded bg-no-soft px-1.5 text-[11px] font-semibold text-no">{formatShares(p.noShares)} No</span>}
      </span>
    );
  };

  const meta = (
    <>
      <span className="tabular font-medium text-ink">{formatLatta(wheel.volumeTicks)} Vol.</span>
      <span className="h-2.5 w-px bg-surface-3" aria-hidden="true" />
      <span className="flex items-center gap-1">
        <ClockIcon size={13} />{" "}
        {done
          ? `Ripened ${formatDate(settlement?.reviewedAt ?? wheel.resolvedAt ?? wheel.createdAt)}`
          : wheel.closesAt
            ? `Closes ${formatDate(wheel.closesAt)}`
            : `Opened ${formatDate(wheel.createdAt)}`}
      </span>
    </>
  );

  const tabs = [
    {
      key: "activity",
      label: "Activity",
      content: activity.length ? (
        <ul>
          {activity.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-line py-3 text-sm last:border-0">
              <Avatar slackId={a.slackId} name={a.name} size={24} />
              <span className="min-w-0 flex-1 text-muted">
                <strong className="font-semibold text-ink">{a.name ?? "Someone"}</strong> {a.side === "BUY" ? "bought" : "sold"}{" "}
                <span className={`font-semibold ${a.outcome === "YES" ? "text-yes" : "text-no"}`}>
                  {formatShares(a.qty)} {outcomeName(a.outcome)}
                </span>
                {!binary && <span> · {labelOf(a.wedgeId)}</span>}
                <span className="tabular"> at {a.price}¢ ({formatLatta(a.price * a.qty)})</span>
                {a.counterpartyIsBot && (
                  <span className="whitespace-nowrap">
                    {" "}
                    {a.side === "BUY" ? "from" : "to"} <MouseIcon size={13} className="inline-block align-[-2px]" /> The Mouse
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[13px] text-muted">{timeAgo(a.at, now)}</span>
              {user?.isCheesemonger && (
                <ActionButton
                  action={undoTradeAction.bind(null, a.id)}
                  className="text-xs font-semibold text-no hover:underline"
                >
                  Reverse
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted">No trades yet.</p>
      ),
    },
    {
      key: "holders",
      label: "Top holders",
      content: (
        <div className="grid gap-8 sm:grid-cols-2">
          {(["yes", "no"] as const).map((side) => (
            <div key={side}>
              <div className="mb-2 flex justify-between border-b border-line pb-2 text-sm font-semibold">
                <span className={side === "yes" ? "text-yes" : "text-no"}>
                  {side === "yes" ? "Yes" : "No"} holders{!binary && <span className="text-muted"> · {selected.label}</span>}
                </span>
                <span className="text-xs font-medium uppercase tracking-wider text-muted">Shares</span>
              </div>
              {holders[side].length ? (
                <ol className="space-y-2.5">
                  {holders[side].map((h, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm">
                      <Avatar slackId={h.slackId} name={h.name} size={28} />
                      <span className="min-w-0 flex-1 truncate font-medium">{h.isBot ? (
                          <span className="inline-flex items-center gap-1">
                            <MouseIcon size={14} /> The Mouse
                          </span>
                        ) : (
                          (h.name ?? "Hack Clubber")
                        )}</span>
                      <span className={`tabular font-semibold ${side === "yes" ? "text-yes" : "text-no"}`}>{formatShares(h.shares)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Nobody yet.</p>
              )}
            </div>
          ))}
        </div>
      ),
    },
    ...(mine.orders.length
      ? [
          {
            key: "orders",
            label: `Your orders (${mine.orders.length})`,
            content: (
              <ul className="text-sm">
                {mine.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                    <span>
                      <span className={`font-semibold ${o.side === "BUY" ? "text-yes" : "text-no"}`}>{o.side === "BUY" ? "Buy" : "Sell"}</span>{" "}
                      {outcomeName(o.outcome)}
                      {!binary && <span className="text-muted"> · {labelOf(o.wedgeId)}</span>}
                    </span>
                    <span className="tabular text-muted">
                      {formatShares(o.remaining)} @ {o.price}¢
                    </span>
                    <ActionButton action={cancelOrderAction.bind(null, o.id)} className="text-xs font-semibold text-no hover:underline">
                      Cancel
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];

  const resolved = resolvedLabel(wheel);

  return (
    <div className="rise-in grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-8 pb-20 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-0 xl:grid-cols-[minmax(0,938px)_372px] xl:justify-center">
      <div className="min-w-0 space-y-8">
        <header className="flex items-start gap-4">
          <WheelIcon icon={wheel.icon} category={wheel.category} size={64} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-[540] text-muted">
              {wheel.category && (
                <>
                  <Link href={`/?c=${encodeURIComponent(wheel.category)}`} className="hover:text-ink">
                    {wheel.category}
                  </Link>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>by {creatorName ?? "a Hack Clubber"}</span>
              {(wheel.status !== "open" || wheel.tradingPausedAt) && (
                <WheelStatus wheel={wheel} className="ml-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-ink" />
              )}
            </div>
            <h1 className="text-pretty text-xl font-semibold leading-7 tracking-[-0.015em] sm:text-2xl">{wheel.title}</h1>
          </div>
          <ShareButton
            url={shareUrl}
            title={wheel.title}
            text={`${wheel.title} Trade on it with Latta Cheese on Cheddar.`}
          />
          {user && !user.isSuspended && wheel.creatorId !== user.id && <ReportButton targetType="wheel" targetId={wheel.id} />}
          {user?.isCheesemonger && !done && (
            <Link
              href={`/wheel/${wheel.slug}/edit`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-surface-2 px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-ink"
            >
              <PencilIcon size={14} /> Edit
            </Link>
          )}
        </header>

        {done && resolved && (
          <section
            className={`rounded-xl p-4 ${wheel.status === "moldy" ? "bg-surface-2" : "bg-yes-soft"}`}
            aria-label="Result"
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  wheel.status === "moldy" ? "bg-surface-3 text-ink" : "bg-yes-solid text-white"
                }`}
              >
                {wheel.status === "moldy" ? <MoldIcon size={18} /> : <TickIcon size={17} strokeWidth={3} />}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-6">{resolved}</h2>
                <p className="text-sm text-muted">
                  {wheel.status === "moldy" ? "Voided. Every share paid 0.50 Lc." : "Winning shares paid 1 Lc each; the rest paid nothing."}
                  {settlement?.reviewedAt && ` Ripened ${formatDate(settlement.reviewedAt)}`}
                  {settlement?.reviewedAt && (settlementBy ? ` by ${settlementBy}.` : ".")}
                  {settlementProposedBy && ` Result proposed by ${settlementProposedBy}.`}
                </p>
              </div>
            </div>
            {settlement?.proof && (
              <div className="mt-3 rounded-lg bg-surface/70 p-3 text-sm">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  <ShieldIcon size={13} /> Proof
                </div>
                <p className="whitespace-pre-wrap leading-6">
                  <Linkified text={settlement.proof} />
                </p>
              </div>
            )}
          </section>
        )}

        {settlement && settlement.status === "pending" && (
          <section className="flex items-start gap-3 rounded-xl border border-accent/50 bg-accent-soft p-4 text-sm">
            <CheeseIcon size={20} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h2 className="font-semibold">Ripening</h2>
              <p className="mt-0.5 text-muted">
                Someone asked to close this wheel. Trading is paused while the Cheesemongers check the result. If they
                don&apos;t agree, trading reopens.
              </p>
            </div>
          </section>
        )}

        {pair && (
          <section className="rounded-xl bg-surface p-4 shadow-soft sm:p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3">
              {sorted.map((w, i) => (
                <div key={w.id} className="contents">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="h-7 w-7 shrink-0 rounded-md" style={{ background: PAIR[i] }} aria-hidden="true" />
                    <span className="truncate text-xl">{w.label}</span>
                    {w.status === "resolved_yes" && <span className="text-sm font-semibold text-yes">Won</span>}
                    {youHold(w.id)}
                  </div>
                  <span className="tabular text-right text-xl font-semibold" style={{ color: PAIR[i] }}>
                    {formatChance(w.chance)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              {sorted.map((w, i) => (
                <span key={w.id} style={{ width: `${w.chance ?? 0}%`, background: PAIR[i] }} />
              ))}
            </div>
          </section>
        )}

        <section>
          <PriceChart series={series} now={now} headline={binary} meta={meta} colors={pair ? PAIR : undefined} />
        </section>

        {pair && !done && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4">
            <div>
              <div className="text-sm font-semibold">Who wins?</div>
              <div className="tabular text-xs text-muted">{formatLatta(wheel.volumeTicks, { compact: true })} Vol.</div>
            </div>
            <div className="flex w-full gap-3 sm:w-[300px]">
              {sorted.map((w, i) => {
                const px = bestPrice(depth.get(w.id) ?? { bids: [], asks: [] }, "YES", "BUY");
                const on = w.id === selected.id && outcome === "YES";
                return (
                  <Link
                    key={w.id}
                    href={`?w=${w.id}&o=YES`}
                    scroll={false}
                    className={`btn-3d flex h-11 flex-1 items-center justify-center gap-1.5 text-white ${on ? "" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: PAIR[i] }}
                  >
                    <span className="max-w-24 truncate text-xs font-semibold uppercase opacity-80">{w.label}</span>
                    {wheel.marketType === "date" && w.dateValue && (
                      <span className="ml-1 text-[10px] text-muted">{formatDateEst(w.dateValue)}</span>
                    )}
                    <span className="tabular text-sm font-bold">{px == null ? "—" : `${px}¢`}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {!binary && (
          <section>
            <div className="flex items-center pb-2 text-xs font-medium uppercase tracking-wider text-muted">
              <span className="flex-[3]">Outcome</span>
              <span className="hidden flex-1 text-center sm:block">% chance</span>
              <span className="hidden flex-[3] sm:block" />
            </div>
            <ul className="border-t border-line">
              {sorted.map((w) => {
                const d = depth.get(w.id) ?? { bids: [], asks: [] };
                const active = w.id === selected.id;
                const yesPx = bestPrice(d, "YES", "BUY");
                const noPx = bestPrice(d, "NO", "BUY");
                return (
                  <li key={w.id} className="group/row relative flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line py-3">
                    <span
                      className={`pointer-events-none absolute -inset-x-3 inset-y-0 rounded-md transition-colors ${
                        active ? "bg-hover" : "group-hover/row:bg-hover"
                      }`}
                      aria-hidden="true"
                    />
                    <Link href={`?w=${w.id}&o=${outcome}`} scroll={false} className="relative flex min-w-0 flex-[3] basis-48 items-center gap-4">
                      <WheelIcon category={wheel.category} size={40} />
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold">
                          {w.label}
                          {wheel.marketType === "date" && w.dateValue && (
                            <span className="ml-1 text-[10px] text-muted block">{formatDateEst(w.dateValue)}</span>
                          )}
                          {w.status === "resolved_yes" && <span className="ml-1.5 text-sm text-yes">Won</span>}
                          {w.status === "halted" && <span className="ml-1.5 text-sm text-no">Halted</span>}
                        </span>
                        <span className="tabular text-[13px] text-muted">
                          {formatLatta(w.volumeTicks)} Vol.
                          {youHold(w.id)}
                        </span>
                      </span>
                    </Link>
                    <div className="relative flex flex-1 items-center justify-end gap-2 sm:justify-center">
                      <span className="tabular text-[28px] font-semibold leading-none">{formatChance(w.chance)}</span>
                      <Change value={w.change24h} className="text-xs" />
                    </div>
                    {!done && (
                      <div className="relative flex w-full gap-2 sm:w-auto sm:flex-[3] sm:justify-end">
                        <Link
                          href={`?w=${w.id}&o=YES`}
                          scroll={false}
                          className={`flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm font-semibold transition-colors sm:max-w-[136px] ${
                            active && outcome === "YES" ? "bg-yes-solid text-white" : "bg-yes-soft text-yes hover:bg-yes-soft-hover"
                          }`}
                        >
                          <span className="opacity-80">Buy Yes</span>
                          <span className="tabular text-base">{yesPx == null ? "—" : `${yesPx}¢`}</span>
                        </Link>
                        <Link
                          href={`?w=${w.id}&o=NO`}
                          scroll={false}
                          className={`flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm font-semibold transition-colors sm:max-w-[136px] ${
                            active && outcome === "NO" ? "bg-no-solid text-white" : "bg-no-soft text-no hover:bg-no-soft-hover"
                          }`}
                        >
                          <span className="opacity-80">Buy No</span>
                          <span className="tabular text-base">{noPx == null ? "—" : `${noPx}¢`}</span>
                        </Link>
                        {user?.isCheesemonger && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            {w.status === "open" && (
                              <ReasonAction
                                action={haltWedgeAction.bind(null, w.id, true)}
                                label="Halt"
                                placeholder="Why close this outcome?"
                                danger
                              />
                            )}
                            {w.status === "halted" && (
                              <ActionButton
                                action={haltWedgeAction.bind(null, w.id, false, "")}
                                className="text-xs font-semibold text-yes hover:underline"
                              >
                                Resume
                              </ActionButton>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {done && <span className="relative hidden flex-[3] sm:block" />}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {takesSuggestions && (
          <SuggestOutcome
            wheelId={wheel.id}
            pending={suggestions.map((x) => ({ id: x.id, label: x.label }))}
            canSuggest={!!user && !user.isSuspended && !user.isMouseFunder}
            loginHref={user ? undefined : `/api/auth/login?returnTo=/wheel/${slug}`}
            isCheesemonger={!!user?.isCheesemonger}
          />
        )}

        {!done && (
          <details open className="group/ob rounded-xl bg-surface shadow-mid">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 hover:bg-hover [&::-webkit-details-marker]:hidden">
              <span className="text-base font-semibold">
                Order Book{!binary && <span className="font-medium text-muted"> · {selected.label}</span>}
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted transition-transform group-open/ob:rotate-180"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="px-4 pb-4">
              <div className="mb-3 flex gap-1 text-sm font-semibold">
                {(["YES", "NO"] as const).map((o) => (
                  <Link
                    key={o}
                    href={`?w=${selected.id}&o=${o}`}
                    scroll={false}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${outcome === o ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
                  >
                    Trade {outcomeName(o)}
                  </Link>
                ))}
              </div>
              <OrderBookView depth={selectedDepth} outcome={outcome} />
            </div>
          </details>
        )}

        {canSettle && (
          <SettleForm
            id="close"
            wheelId={wheel.id}
            wedges={wheel.wedges.map((w) => ({
              id: w.id,
              label: w.label,
              dateValue: w.dateValue?.toISOString() ?? null,
            }))}
            marketType={wheel.marketType}
          />
        )}

        <section>
          <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em]">Rules</h2>
          {wheel.description && <p className="mb-3 whitespace-pre-wrap text-sm leading-6 text-muted">{wheel.description}</p>}
          <p className="whitespace-pre-wrap text-sm leading-6">{wheel.resolutionCriteria}</p>
          <dl className="mt-4 grid gap-3 rounded-xl bg-surface p-4 text-sm shadow-soft sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-muted">Opened</dt>
              <dd className="mt-0.5 font-medium">{formatDate(wheel.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">Closes</dt>
              <dd className="mt-0.5 font-medium">
                {wheel.closesAt
                  ? wheel.closesAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
                  : "When the result is known"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">Resolver</dt>
              <dd className="mt-0.5 font-medium text-primary">Cheesemongers</dd>
            </div>
            {wheel.allowAdditions && !binary && (
              <div className="sm:col-span-3">
                <dt className="text-xs font-medium text-muted">Outcomes</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                  <ListPlusIcon size={15} />
                  <span>Open to new ones. If one is added, every existing outcome gains one more way to resolve No.</span>
                </dd>
              </div>
            )}
            <div className="sm:col-span-3">
              <dt className="text-xs font-medium text-muted">Market maker</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <MouseIcon size={15} />
                {wheel.liquidity > 0 ? (
                  <span>
                    The Mouse quotes both sides here (depth {wheel.liquidity.toLocaleString("en-US")}), so you can always trade;
                    big orders just move the price.
                  </span>
                ) : (
                  <span className="text-muted">None. Trades only fill against other people&apos;s orders.</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <Tabs tabs={tabs} />
        </section>
      </div>

      <aside className="space-y-8 lg:sticky lg:top-[129px] lg:self-start">
        {user && <PositionCard lines={positionLines} />}
        <div id="trade" className="scroll-mt-32">
          <TradePanel
            wedges={tradeWedges}
            wedgeId={selected.id}
            outcome={outcome}
            availableTicks={bal.available}
            gate={gate}
            binary={binary}
            title={wheel.title}
            category={wheel.category}
            icon={wheel.icon}
          />
        </div>
        {user && !done && (
          <LinkedActions
            wheelId={wheel.id}
            binary={binary}
            fixedOutcomes={!wheel.allowAdditions}
            wedges={tradeWedges.map((t) => ({ id: t.id, label: t.label, freeYes: t.freeYes, freeNo: t.freeNo }))}
          />
        )}
        {related.length > 0 && (
          <div className="border-t border-dashed border-line pt-5">
            <h2 className="mb-2 text-sm font-semibold">More in {wheel.category ?? "Cheddar"}</h2>
            <ul>
              {related.map((r) => {
                const top = [...r.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1))[0];
                return (
                  <li key={r.id}>
                    <Link href={`/wheel/${r.slug}`} className="-mx-2 flex items-center gap-3 rounded-lg p-2 hover:bg-hover">
                      <WheelIcon icon={r.icon} category={r.category} size={32} />
                      <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-[18px]">{r.title}</span>
                      <span className="tabular text-base font-semibold">{formatChance(top?.chance)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </aside>

      {/* Mobile: the trade panel is far down the page, so keep Buy buttons in reach. */}
      {!gate && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl gap-2">
            <a href={`?w=${selected.id}&o=YES#trade`} className="btn-3d flex h-12 flex-1 items-center justify-center bg-yes-solid text-sm font-semibold text-white">
              Buy Yes{buyYes != null && ` ${buyYes}¢`}
            </a>
            <a href={`?w=${selected.id}&o=NO#trade`} className="btn-3d flex h-12 flex-1 items-center justify-center bg-no-solid text-sm font-semibold text-white">
              Buy No{buyNo != null && ` ${buyNo}¢`}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
