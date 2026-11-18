import Link from "next/link";
import { audit } from "@cheddar/exchange";
import { ActionButton, ReasonAction, ReviewButtons } from "@/components/ActionButton";
import { CategoryForm } from "@/components/CategoryForm";
import { CategoryIconEditor } from "@/components/CategoryIconEditor";
import { FunderForm } from "@/components/FunderForm";
import { GrantForm } from "@/components/GrantForm";
import { LiquidityControl } from "@/components/LiquidityControl";
import { AlertIcon, CheckIcon, CheeseIcon, ListPlusIcon, MouseIcon, PauseIcon, PencilIcon } from "@/components/Icons";
import { Avatar, WheelIcon } from "@/components/Logo";
import { SlackAnnounce } from "@/components/SlackAnnounce";
import {
  pauseWheelAction,
  removeCategoryAction,
  removeFunderAction,
  renameUserAction,
  resolveReportAction,
  resumeWheelAction,
  reviewOutcomeAction,
  reviewProposalAction,
  reviewSettlementAction,
  setCheesemongerAction,
  setSuperAdminAction,
  suspendUserAction,
  unsuspendUserAction,
} from "@/lib/actions";
import { getDb } from "@/lib/db";
import { listMarketIcons } from "@/lib/market-icons";
import { env } from "@/lib/env";
import { formatDate, formatLatta, timeAgo } from "@/lib/format";
import {
  PAGE_SIZE,
  activeFunders,
  auditLogPage,
  categoryCounts,
  dashboardCounts,
  moderationWheels,
  mouseStatus,
  openReports,
  pendingOutcomeRequests,
  pendingProposals,
  pendingSettlements,
  searchUsers,
  watchLateBuys,
  watchPairs,
} from "@/lib/queries";
import { requireCheesemonger, requireSuperAdmin, type SessionUser } from "@/lib/session";

const CHEESEMONGER_TABS = ["proposals", "outcomes", "settlements", "reports", "watch", "wheels"] as const;
const ADMIN_TABS = ["users", "funders", "categories", "logs", "health", "notifications"] as const;
type Tab = (typeof CHEESEMONGER_TABS)[number] | (typeof ADMIN_TABS)[number];
export type DashboardSP = { tab?: string; page?: string; q?: string; filter?: string; action?: string };
type SP = DashboardSP;

/** Which page a tab lives on: Cheesemongers run the markets, super admins run the people and the system. */
const baseFor = (tab: string) => ((ADMIN_TABS as readonly string[]).includes(tab) ? "/admin" : "/cheesemongers");

export async function Dashboard({ area, searchParams }: { area: "cheesemongers" | "admin"; searchParams: Promise<SP> }) {
  const me = area === "admin" ? await requireSuperAdmin() : await requireCheesemonger();
  const sp = await searchParams;
  const TABS: readonly Tab[] = area === "admin" ? ADMIN_TABS : CHEESEMONGER_TABS;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : TABS[0]!;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const counts = await dashboardCounts();

  const labels: Record<Tab, { label: string; count?: number; alert?: boolean }> = {
    proposals: { label: "Wheel proposals", count: counts.proposals, alert: counts.proposals > 0 },
    outcomes: { label: "New outcomes", count: counts.outcomes, alert: counts.outcomes > 0 },
    settlements: { label: "Settlements", count: counts.settlements, alert: counts.settlements > 0 },
    reports: { label: "Reports", count: counts.reports, alert: counts.reports > 0 },
    watch: { label: "Watch" },
    wheels: { label: "Wheels", count: counts.paused || undefined },
    users: { label: "Users", count: counts.suspended || undefined },
    funders: { label: "Mouse funders", count: counts.funders },
    categories: { label: "Categories" },
    logs: { label: "Logs" },
    health: { label: "Health" },
    notifications: { label: "Slack" },
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{area === "admin" ? "Super admin" : "Cheesemongers"}</h1>
          <p className="mt-1 text-sm text-muted">
            {area === "admin"
              ? "People, Mouse funders, categories, the audit log and the ledger's health."
              : "Review wheels and new outcomes, ripen settlements, and look after live wheels."}
            {area !== "admin" && !env.allowSelfReview && " Someone else has to review anything you proposed."}
          </p>
        </div>
        {me.isSuperAdmin && (
          <Link
            href={area === "admin" ? "/cheesemongers" : "/admin"}
            className="rounded-[10px] bg-surface-2 px-3 py-2 text-sm font-semibold text-muted hover:bg-hover hover:text-ink"
          >
            {area === "admin" ? "Cheesemongers →" : "Super admin →"}
          </Link>
        )}
      </div>

      <nav className="-mx-4 mt-5 flex gap-1 overflow-x-auto border-b border-line px-4" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`${baseFor(t)}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
              tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {labels[t].label}
            {labels[t].count !== undefined && (
              <span
                className={`tabular rounded-full px-1.5 text-[11px] font-semibold ${
                  labels[t].alert ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
                }`}
              >
                {labels[t].count}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "proposals" && <ProposalsTab me={me} page={page} />}
        {tab === "outcomes" && <OutcomesTab me={me} />}
        {tab === "settlements" && <SettlementsTab me={me} />}
        {tab === "reports" && <ReportsTab />}
        {tab === "watch" && <WatchTab />}
        {tab === "wheels" && <WheelsTab q={sp.q} page={page} />}
        {tab === "users" && <UsersTab me={me} q={sp.q} filter={sp.filter} page={page} />}
        {tab === "funders" && <FundersTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "logs" && <LogsTab action={sp.action} page={page} />}
        {tab === "health" && <HealthTab />}
        {tab === "notifications" && <SlackAnnounce />}
      </div>
    </div>
  );
}

// ---------- tabs ----------

async function ProposalsTab({ me, page }: { me: SessionUser; page: number }) {
  const { rows, total } = await pendingProposals(page);
  if (!total) return <Empty>No proposals waiting.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {total} waiting, oldest first. Check the question is clear, resolvable, and not a duplicate.
      </p>
      {rows.map(({ p, proposer, proposerSlack }) => (
        <article key={p.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <WheelIcon icon={p.icon} category={p.category} size={44} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{p.title}</h3>
              <span className="flex items-center gap-3 text-xs text-muted">
                by {proposer ?? proposerSlack ?? "someone"} · {formatDate(p.createdAt)}
                <Link
                  href={`/cheesemongers/proposals/${p.id}/edit`}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 font-semibold text-ink hover:bg-hover"
                >
                  <PencilIcon size={12} /> Edit
                </Link>
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {p.category && <Chip>{p.category}</Chip>}
            <Chip>{p.closesAt ? `Closes ${p.closesAt.toLocaleString("en-US")}` : "Closes on request"}</Chip>
            {p.allowAdditions && <Chip>Open to new outcomes</Chip>}
            <Chip>{p.outcomes.length > 1 ? `${p.outcomes.length} outcomes` : "Yes / No"}</Chip>
            {p.outcomes.length > 1 &&
              p.outcomes.map((o) => (
                <span key={o} className="rounded bg-accent-soft px-1.5 py-0.5">
                  {o}
                </span>
              ))}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm">{p.resolutionCriteria}</p>
          {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{p.description}</p>}
          {p.proposerId === me.id && !env.allowSelfReview ? (
            <p className="mt-3 text-xs text-muted">You proposed this, so another Cheesemonger has to review it.</p>
          ) : (
            <ReviewButtons
              action={reviewProposalAction.bind(null, p.id)}
              approveConsequence="The wheel goes live and anyone can trade on it. The Mouse starts quoting at even odds."
              liquidity={300}
              rejectConsequence="The proposal is closed. Your note is shown to the author."
            />
          )}
        </article>
      ))}
      <Pager tab="proposals" page={page} total={total} size={PAGE_SIZE.proposals} />
    </div>
  );
}

async function OutcomesTab({ me }: { me: SessionUser }) {
  const rows = await pendingOutcomeRequests();
  if (!rows.length) return <Empty>No suggested outcomes waiting.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        People suggested these on wheels that are open to new outcomes. Approving adds it as a tradable outcome straight away.
      </p>
      {rows.map(({ r, wheel, proposer, proposerSlack, outcomes }) => {
        const n = outcomes.length;
        const even = Math.round(100 / (n + 1));
        return (
          <article key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <WheelIcon icon={wheel.icon} category={wheel.category} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/wheel/${wheel.slug}`} className="font-semibold hover:underline">
                    {wheel.title}
                  </Link>
                  <span className="text-xs text-muted">
                    by {proposer ?? proposerSlack ?? "someone"} · {formatDate(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm">
                  <ListPlusIcon size={15} className="text-muted" /> Add <strong>“{r.label}”</strong>
                </p>
                {r.note && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.note}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {outcomes.map((o) => (
                    <span key={o.id} className="rounded bg-surface-2 px-1.5 py-0.5">
                      {o.label}
                      {o.chance != null && <span className="text-muted"> {Math.round(o.chance)}%</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {wheel.status !== "open" ? (
              <p className="mt-3 text-xs text-muted">This wheel isn&apos;t open any more, so it can only be rejected.</p>
            ) : null}
            {r.proposerId === me.id && !env.allowSelfReview ? (
              <p className="mt-3 text-xs text-muted">You suggested this, so another Cheesemonger has to review it.</p>
            ) : (
              <ReviewButtons
                action={reviewOutcomeAction.bind(null, r.id)}
                outcome={{ label: r.label, startChance: even }}
                approveConsequence={`“${r.label}” becomes outcome ${n + 1}. ${
                  wheel.liquidity > 0 ? "The Mouse starts it at the chance above and scales the others down to fit." : "It starts with no quotes."
                } Nobody's existing shares change.`}
                rejectConsequence="The suggestion is closed. Your note is kept in the log."
                noteLabel="Note (optional)"
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

async function SettlementsTab({ me }: { me: SessionUser }) {
  const rows = await pendingSettlements();
  if (!rows.length) return <Empty>Nothing ripening.</Empty>;
  return (
    <div className="space-y-3">
      {rows.map(({ s, wheel, proposer, wedgeLabel, preview }) => {
        const result =
          s.outcome === "moldy"
            ? "Moldy: every share pays 0.50 Lc"
            : s.outcome === "all_no"
              ? "Resolves No"
              : wedgeLabel === "Yes"
                ? "Resolves Yes"
                : `${wedgeLabel} wins, every other outcome resolves No`;
        return (
        <article key={s.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/wheel/${wheel.slug}`} className="font-semibold hover:underline">
              {wheel.title}
            </Link>
            <span className="text-xs text-muted">
              proposed by {proposer ?? "someone"} · {formatDate(s.createdAt)}
            </span>
          </div>
          <p className="mt-2 text-sm">
            Outcome:{" "}
            <strong>
              {s.outcome === "moldy"
                ? "Moldy (void, 50/50)"
                : s.outcome === "all_no"
                  ? "No"
                  : wedgeLabel === "Yes"
                    ? "Yes"
                    : `${wedgeLabel} wins`}
            </strong>
          </p>
          <div className="mt-2 rounded-lg bg-surface-2 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold text-muted">Close request · only Cheesemongers see this</div>
            <p className="whitespace-pre-wrap">{s.evidence}</p>
          </div>
          <p className="mt-2 text-xs text-muted">Criteria: {wheel.resolutionCriteria}</p>
          {s.proposerId === me.id && !env.allowSelfReview ? (
            <p className="mt-3 text-xs text-muted">You proposed this, so another Cheesemonger has to review it.</p>
          ) : (
            <ReviewButtons
              action={reviewSettlementAction.bind(null, s.id)}
              approveConsequence={`${result}. Pays ${formatLatta(preview.paidTicks)} to ${preview.holders} holder${preview.holders === 1 ? "" : "s"} and closes the wheel for good. This can't be undone.`}
              rejectConsequence="The request is thrown out and trading reopens. The wheel can be closed again later."
              noteLabel="Private note (Cheesemongers' log only)"
              proof={{
                label: "Proof",
                placeholder: "Links, numbers or a short explanation of why this is the result…",
                hint: "Shown in the banner at the top of the closed wheel. The request and your note are never shown publicly.",
              }}
            />
          )}
        </article>
        );
      })}
    </div>
  );
}

async function WheelsTab({ q, page }: { q?: string; page: number }) {
  const { rows, total } = await moderationWheels({ q, page });
  return (
    <div>
      <SearchBox tab="wheels" q={q} placeholder="Search wheels" />
      {!rows.length ? (
        <Empty>No live wheels{q ? " match" : ""}.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map(({ w, creator, outcomes }) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/wheel/${w.slug}`} className="font-medium hover:underline">
                  {w.title}
                </Link>
                <div className="text-xs text-muted">
                  by {creator ?? "someone"} · {w.status}
                  {w.closesAt && ` · closes ${formatDate(w.closesAt)}`}
                  {w.tradingPausedAt && (
                    <span className="ml-1 inline-flex items-center gap-1 font-semibold text-no">
                      · <PauseIcon size={11} /> paused{w.pauseReason ? `: ${w.pauseReason}` : ""}
                    </span>
                  )}
                </div>
              </div>
              {w.status === "open" && <LiquidityControl wheelId={w.id} liquidity={w.liquidity} outcomes={Number(outcomes)} />}
              <Link href={`/wheel/${w.slug}/edit`} className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:underline">
                <PencilIcon size={12} /> Edit
              </Link>
              {(w.status === "open" || w.status === "closed") && (
                <Link href={`/wheel/${w.slug}#close`} className="text-xs font-semibold text-ink hover:underline">
                  Close &amp; settle…
                </Link>
              )}
              {w.tradingPausedAt ? (
                <ActionButton action={resumeWheelAction.bind(null, w.id)} className="text-xs font-semibold text-yes hover:underline">
                  Resume trading
                </ActionButton>
              ) : (
                <ReasonAction action={pauseWheelAction.bind(null, w.id)} label="Pause trading" placeholder="Why? (shown to traders)" danger />
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager tab="wheels" page={page} total={total} size={PAGE_SIZE.wheels} extra={{ q }} />
    </div>
  );
}

async function UsersTab({ me, q, filter, page }: { me: SessionUser; q?: string; filter?: string; page: number }) {
  const f = filter === "suspended" || filter === "cheesemongers" ? filter : "all";
  const { rows, total } = await searchUsers({ q, filter: f, page });
  return (
    <div>
      <SearchBox tab="users" q={q} placeholder="Search by name or Slack ID" extra={{ filter: f === "all" ? undefined : f }} />
      <div className="mb-3 flex gap-1.5 text-xs">
        {(["all", "suspended", "cheesemongers"] as const).map((x) => (
          <Link
            key={x}
            href={`/admin?tab=users${x === "all" ? "" : `&filter=${x}`}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-2.5 py-1 font-medium ${f === x ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"}`}
          >
            {x[0]!.toUpperCase() + x.slice(1)}
          </Link>
        ))}
      </div>
      {!rows.length ? (
        <Empty>No users found.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map(({ u, balance, funder, syncStatus, syncError, syncAt }) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Avatar slackId={u.slackId} name={u.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  {u.name ?? (u.hcaSub ? "Hack Clubber" : u.slackId)}
                  {!u.hcaSub && <Badge>Not signed up</Badge>}
                  {u.isSuperAdmin && <Badge tone="accent">Super admin</Badge>}
                  {u.isCheesemonger && !u.isSuperAdmin && <Badge tone="accent">Cheesemonger</Badge>}
                  {funder && (
                    <Badge>
                      <MouseIcon size={11} /> Funder
                    </Badge>
                  )}
                  {u.suspendedAt && <Badge tone="no">Suspended</Badge>}
                  {u.id === me.id && <Badge>You</Badge>}
                </div>
                <div className="text-xs text-muted">
                  <span className="font-mono">{u.slackId ?? "no Slack"}</span> · {formatLatta(balance ?? 0)} ·{" "}
                  {u.hackatimeUserId
                    ? `Hackatime #${u.hackatimeUserId}`
                    : u.slackId
                      ? "Hackatime via Slack ID"
                      : "Hackatime not linked"}
                  {" · "}
                  {!syncStatus
                    ? "not synced yet"
                    : syncStatus === "error"
                      ? syncError?.startsWith("PRIVATE")
                        ? "stats private"
                        : syncError?.startsWith("NOT_FOUND")
                          ? "no Hackatime coding found"
                          : "last sync failed"
                      : syncStatus === "skipped_untrusted"
                        ? "flagged on Hackatime"
                        : `synced ${timeAgo(new Date(syncAt!))}`} · joined {formatDate(u.createdAt)}
                  {u.suspendedAt && u.suspendReason && <span className="text-no"> · “{u.suspendReason}”</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {!u.isBot && u.hcaSub && <GrantForm userId={u.id} name={u.name ?? "them"} />}
                {!u.isBot && <ReasonAction action={renameUserAction.bind(null, u.id)} label="Rename" placeholder="New name" />}
                {u.id !== me.id &&
                  (u.suspendedAt ? (
                    <ReasonAction action={unsuspendUserAction.bind(null, u.id)} label="Unsuspend" placeholder="Note (optional)" optional />
                  ) : (
                    !u.isCheesemonger && (
                      <ReasonAction action={suspendUserAction.bind(null, u.id)} label="Suspend" placeholder="Reason (shown to them)" danger />
                    )
                  ))}
                {!u.suspendedAt && u.id !== me.id && !u.isBot && (
                  <ActionButton
                    action={setSuperAdminAction.bind(null, u.id, !u.isSuperAdmin)}
                    confirm={
                      u.isSuperAdmin
                        ? `Remove ${u.name ?? "them"} as a super admin? They stay a Cheesemonger.`
                        : `Make ${u.name ?? "them"} a super admin? They'll manage users, Mouse funders, logs and health.`
                    }
                    className="text-xs font-semibold text-muted hover:text-ink hover:underline"
                  >
                    {u.isSuperAdmin ? "Remove super admin" : "Make super admin"}
                  </ActionButton>
                )}
                {!u.suspendedAt && u.id !== me.id && !u.isSuperAdmin && (
                  <ActionButton
                    action={setCheesemongerAction.bind(null, u.id, !u.isCheesemonger)}
                    confirm={u.isCheesemonger ? `Remove ${u.name ?? "them"} as a Cheesemonger?` : `Make ${u.name ?? "them"} a Cheesemonger?`}
                    className="text-xs font-semibold text-muted hover:text-ink hover:underline"
                  >
                    {u.isCheesemonger ? "Demote" : "Make Cheesemonger"}
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager tab="users" page={page} total={total} size={PAGE_SIZE.users} extra={{ q, filter: f === "all" ? undefined : f }} />
    </div>
  );
}

async function ReportsTab() {
  const rows = await openReports();
  if (!rows.length) return <Empty>No open reports.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{rows.length} open, oldest first. Deal with it, then mark it handled or dismiss it.</p>
      {rows.map((r) => (
        <article key={r.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {r.targetType === "wheel" ? (
                <Link href={`/wheel/${r.wheelSlug}`} className="hover:underline">
                  {r.wheelTitle ?? "A wheel"}
                </Link>
              ) : (
                <Link href={`/u/${r.targetId}`} className="hover:underline">
                  Name: {r.userName ?? r.userSlack ?? "a user"}
                </Link>
              )}
            </h3>
            <span className="text-xs text-muted">
              {r.targetType === "wheel" ? "Wheel" : "User"} · reported by {r.reporterName ?? r.reporterSlack ?? "someone"} · {formatDate(new Date(r.createdAt))}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{r.reason}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {r.targetType === "user" && <ReasonAction action={renameUserAction.bind(null, r.targetId)} label="Rename them" placeholder="New name" />}
            <ReasonAction action={resolveReportAction.bind(null, r.id, "actioned")} label="Mark handled" placeholder="What you did (optional)" optional />
            <ReasonAction action={resolveReportAction.bind(null, r.id, "dismissed")} label="Dismiss" placeholder="Why (optional)" optional />
          </div>
        </article>
      ))}
    </div>
  );
}

async function WatchTab() {
  const [pairs, late] = await Promise.all([watchPairs(), watchLateBuys()]);
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold">Trading back and forth</h2>
        <p className="mb-3 mt-0.5 text-sm text-muted">
          Pairs of people who traded with each other 5+ times in the last 7 days. Often just friends on a busy market, but worth a look for wash trading or alts.
        </p>
        {!pairs.length ? (
          <Empty>Nothing unusual.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {pairs.map((p) => (
              <li key={`${p.aId}-${p.bId}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium">
                  {p.aName ?? "Hack Clubber"} <span className="text-muted">↔</span> {p.bName ?? "Hack Clubber"}
                </span>
                <span className="tabular text-muted">
                  {p.trades} trades · {p.shares} shares · {p.wedges} market{p.wedges === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-base font-semibold">Big buys just before a result</h2>
        <p className="mb-3 mt-0.5 text-sm text-muted">
          People who bought 100+ shares in the 24 hours before a result was proposed (last 30 days). Possible insider trading, so check what they could have known.
        </p>
        {!late.length ? (
          <Empty>Nothing unusual.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {late.map((l) => (
              <li key={`${l.userId}-${l.wheelSlug}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{l.userName ?? "Hack Clubber"}</span> <span className="text-muted">on</span>{" "}
                  <Link href={`/wheel/${l.wheelSlug}`} className="hover:underline">
                    {l.wheelTitle}
                  </Link>
                </span>
                <span className="tabular text-muted">
                  {l.shares} shares · {l.trades} trade{l.trades === 1 ? "" : "s"} · latest {l.minutesBefore} min before
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function CategoriesTab() {
  const cats = await categoryCounts();
  const icons = listMarketIcons();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <CategoryForm />
        <p className="mt-1 text-xs text-muted">
          Categories show up in the propose form and the filter bar. Removing one moves its wheels to Hack Club.
        </p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
        {cats.map((c) => (
          <li key={c.name} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5">
            <span className="flex items-center gap-2.5">
              <WheelIcon icon={null} category={c.name} size={28} />
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted">
                {c.wheels} wheel{c.wheels === 1 ? "" : "s"}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <span className="flex items-center gap-4">
                <CategoryIconEditor name={c.name} current={c.icon} icons={icons} />
                {c.name === "Hack Club" ? (
                  <span className="text-xs text-muted">Fallback, can&apos;t be removed</span>
                ) : (
                  <ActionButton
                    action={removeCategoryAction.bind(null, c.name)}
                    confirm={
                      c.wheels
                        ? `Remove "${c.name}"? Its ${c.wheels} wheel${c.wheels === 1 ? "" : "s"} will move to Hack Club.`
                        : `Remove "${c.name}"?`
                    }
                    className="text-xs font-semibold text-no hover:underline"
                  >
                    Remove
                  </ActionButton>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function FundersTab() {
  const funders = await activeFunders();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <FunderForm />
      </div>
      {!funders.length ? (
        <Empty>No Mouse funders yet.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {funders.map(({ f, name, signedUp, fedTicks, lastStatus, lastError, lastAt }) => (
            <li key={f.slackId} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="font-mono text-xs">{f.slackId}</span>
                {name && <span> · {name}</span>}
                {!signedUp && <span className="text-muted"> · not on Cheddar (synced by Slack ID)</span>}
                {f.note && <span className="text-muted"> · {f.note}</span>}
                <span className="block text-xs text-muted">
                  Fed <span className="tabular font-semibold text-ink">{formatLatta(Number(fedTicks))}</span>
                  {lastStatus === "error" ? (
                    <span className="text-no">
                      {" "}
                      · last sync failed: {lastError?.includes("public stats") ? "their Hackatime stats are private" : lastError}
                    </span>
                  ) : lastStatus === "skipped_untrusted" ? (
                    <span className="text-no"> · flagged on Hackatime, hours not counted</span>
                  ) : lastAt ? (
                    <> · synced {new Date(lastAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>
                  ) : (
                    <> · not synced yet</>
                  )}
                </span>
              </span>
              <ActionButton
                action={removeFunderAction.bind(null, f.slackId)}
                confirm="Stop routing their future Churn to The Mouse?"
                className="text-xs font-semibold text-no hover:underline"
              >
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "proposal.submit": "submitted a proposal",
  "proposal.approve": "approved a proposal",
  "proposal.reject": "rejected a proposal",
  "proposal.withdraw": "withdrew a proposal",
  "proposal.edit": "edited a proposal",
  "wheel.edit": "edited a wheel",
  "wheel.liquidity": "set The Mouse's depth",
  "outcome.request": "suggested an outcome",
  "outcome.approve": "added a suggested outcome",
  "outcome.reject": "rejected a suggested outcome",
  "outcome.add": "added an outcome",
  "settlement.propose": "proposed a settlement",
  "settlement.approve": "ripened a wheel",
  "settlement.reject": "rejected a settlement",
  "funder.add": "added a Mouse funder",
  "funder.remove": "removed a Mouse funder",
  "user.suspend": "suspended a user",
  "user.unsuspend": "unsuspended a user",
  "user.promote": "made a Cheesemonger",
  "user.demote": "removed a Cheesemonger",
  "wheel.pause": "paused trading",
  "wheel.resume": "resumed trading",
  "wedge.halt": "halted an outcome",
  "wedge.resume": "reopened an outcome",
  "trade.reverse": "reversed a trade",
  "churn.run": "ran Churn",
};

async function LogsTab({ action, page }: { action?: string; page: number }) {
  const { rows, total } = await auditLogPage({ action, page });
  const filters = ["", "proposal", "outcome", "settlement", "wheel", "user", "funder", "churn"];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {filters.map((f) => (
          <Link
            key={f || "all"}
            href={`/admin?tab=logs${f ? `&action=${f}.` : ""}`}
            className={`rounded-full px-2.5 py-1 font-medium ${
              (action ?? "") === (f ? `${f}.` : "") ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"
            }`}
          >
            {f ? f[0]!.toUpperCase() + f.slice(1) + "s" : "All"}
          </Link>
        ))}
      </div>
      {!rows.length ? (
        <Empty>No log entries.</Empty>
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {rows.map(({ l, actor }) => {
            const d = l.details as Record<string, unknown>;
            const title = typeof d.title === "string" ? d.title : typeof d.name === "string" ? d.name : null;
            const slug = typeof d.slug === "string" ? d.slug : null;
            const why = [d.reason, d.note, d.wasPausedFor, d.wasSuspendedFor].find((x) => typeof x === "string" && x) as string | undefined;
            return (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5">
                <time className="tabular w-36 shrink-0 text-xs text-muted" dateTime={l.at.toISOString()}>
                  {l.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </time>
                <span className="min-w-0 flex-1">
                  <strong>{l.actorId ? (actor ?? "someone") : "System"}</strong> {ACTION_LABELS[l.action] ?? l.action}
                  {title &&
                    (slug ? (
                      <>
                        {" "}
                        <Link href={`/wheel/${slug}`} className="underline underline-offset-2">
                          {title}
                        </Link>
                      </>
                    ) : (
                      <> · {title}</>
                    ))}
                  {l.targetType === "funder" && <span className="font-mono text-xs"> {l.targetId}</span>}
                  {l.action === "churn.run" && (
                    <span className="text-muted">
                      {" "}
                      · {String(d.users)} users, +{formatLatta(Number(d.creditedTicks ?? 0))}
                    </span>
                  )}
                  {l.action === "settlement.approve" && typeof d.paidTicks === "number" && (
                    <span className="text-muted"> · paid {formatLatta(d.paidTicks)}</span>
                  )}
                  {why && <span className="text-muted"> · “{why}”</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Pager tab="logs" page={page} total={total} size={PAGE_SIZE.logs} extra={{ action }} />
    </div>
  );
}

async function HealthTab() {
  const [problems, mouse] = await Promise.all([getDb().then((db) => audit(db)), mouseStatus()]);
  const minutes = Number(process.env.CHURN_INTERVAL_MINUTES ?? "15");
  return (
    <div className="space-y-4">
      <section className={`rounded-xl border p-4 text-sm ${problems.length ? "border-no bg-no-soft" : "border-line bg-surface"}`}>
        {problems.length ? (
          <>
            <strong className="inline-flex items-center gap-1.5">
              <AlertIcon size={15} /> Ledger audit found {problems.length} problem(s).
            </strong>{" "}
            Stop approving settlements and check:
            <ul className="mt-2 list-disc pl-5 font-mono text-xs">
              {problems.slice(0, 20).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon size={15} className="text-yes" /> Ledger audit clean: every Latta Cheese is accounted for and every share is backed.
          </span>
        )}
      </section>
      <section className="rounded-xl border border-line bg-surface p-4 text-sm">
        <h3 className="mb-3 flex items-center gap-1.5 font-semibold">
          <MouseIcon size={16} /> The Mouse (market maker)
        </h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <MouseStat label="Own cash" value={formatLatta(mouse.availableTicks)} hint={`fed ${formatLatta(mouse.fedTicks)} by funders`} />
          <MouseStat label="In quotes" value={formatLatta(mouse.lockedTicks)} hint={`${mouse.openOrders} open orders`} />
          <MouseStat
            label="House-backed"
            value={formatLatta(mouse.houseTicks)}
            hint={mouse.houseTicks ? "lent because its own cash ran out" : "not needed right now"}
            warn={mouse.houseTicks > 0}
          />
          <MouseStat label="Quoting on" value={`${mouse.quotingWheels} of ${mouse.openWheels}`} hint="open wheels (set depth in Wheels)" />
        </dl>
      </section>
      <section className="rounded-xl border border-line bg-surface p-4 text-sm">
        <CheeseIcon size={15} className="mr-1 inline-block align-[-3px] text-accent" />
        Churn runs automatically{" "}
        {minutes > 0 ? (
          <>
            every <strong>{minutes} min</strong> in this server
          </>
        ) : (
          <>via the cron endpoint only</>
        )}
        . Past runs that paid anything are in the <Link href="/admin?tab=logs&action=churn." className="underline">logs</Link>.
      </section>
    </div>
  );
}

// ---------- bits ----------

function MouseStat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`tabular text-lg font-semibold ${warn ? "text-warn" : ""}`}>{value}</dd>
      <dd className="text-xs text-muted">{hint}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{children}</p>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-surface-2 px-1.5 py-0.5">{children}</span>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" | "no" }) {
  const cls = tone === "accent" ? "bg-accent-soft" : tone === "no" ? "bg-no-soft text-no" : "bg-surface-2 text-muted";
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function SearchBox({ tab, q, placeholder, extra }: { tab: string; q?: string; placeholder: string; extra?: Record<string, string | undefined> }) {
  return (
    <form action={baseFor(tab)} className="mb-3">
      <input type="hidden" name="tab" value={tab} />
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="h-9 w-full max-w-sm rounded-md border border-line bg-surface-2 px-3 text-sm outline-none focus:border-primary"
      />
    </form>
  );
}

function Pager({
  tab,
  page,
  total,
  size,
  extra,
}: {
  tab: string;
  page: number;
  total: number;
  size: number;
  extra?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams({ tab, page: String(p) });
    for (const [k, v] of Object.entries(extra ?? {})) if (v) params.set(k, v);
    return `${baseFor(tab)}?${params}`;
  };
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-2">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-2">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
