import Link from "next/link";
import { audit } from "@cheddar/exchange";
import { ActionButton, ReasonAction, ReviewButtons } from "@/components/ActionButton";
import { FunderForm } from "@/components/FunderForm";
import { LiquidityControl } from "@/components/LiquidityControl";
import { AlertIcon, CheckIcon, CheeseIcon, MouseIcon, PauseIcon } from "@/components/Icons";
import { Avatar, WheelIcon } from "@/components/Logo";
import {
  pauseWheelAction,
  removeFunderAction,
  resumeWheelAction,
  reviewProposalAction,
  reviewSettlementAction,
  setCheesemongerAction,
  suspendUserAction,
  unsuspendUserAction,
} from "@/lib/actions";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatLatta } from "@/lib/format";
import {
  PAGE_SIZE,
  activeFunders,
  auditLogPage,
  dashboardCounts,
  moderationWheels,
  mouseStatus,
  pendingProposals,
  pendingSettlements,
  searchUsers,
} from "@/lib/queries";
import { requireCheesemonger, type SessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cheesemongers · Cheddar" };

const TABS = ["proposals", "settlements", "wheels", "users", "funders", "logs", "health"] as const;
type Tab = (typeof TABS)[number];
type SP = { tab?: string; page?: string; q?: string; filter?: string; action?: string };

export default async function CheesemongersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireCheesemonger();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "proposals";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const counts = await dashboardCounts();

  const labels: Record<Tab, { label: string; count?: number; alert?: boolean }> = {
    proposals: { label: "Wheel proposals", count: counts.proposals, alert: counts.proposals > 0 },
    settlements: { label: "Settlements", count: counts.settlements, alert: counts.settlements > 0 },
    wheels: { label: "Wheels", count: counts.paused || undefined },
    users: { label: "Users", count: counts.suspended || undefined },
    funders: { label: "Mouse funders", count: counts.funders },
    logs: { label: "Logs" },
    health: { label: "Health" },
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Cheesemongers</h1>
      <p className="mt-1 text-sm text-muted">
        Review wheels, ripen settlements, moderate, and keep an eye on the ledger.
        {!env.allowSelfReview && " Someone else has to review anything you proposed."}
      </p>

      <nav className="-mx-4 mt-5 flex gap-1 overflow-x-auto border-b border-line px-4" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/cheesemongers?tab=${t}`}
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
        {tab === "settlements" && <SettlementsTab me={me} />}
        {tab === "wheels" && <WheelsTab q={sp.q} page={page} />}
        {tab === "users" && <UsersTab me={me} q={sp.q} filter={sp.filter} page={page} />}
        {tab === "funders" && <FundersTab />}
        {tab === "logs" && <LogsTab action={sp.action} page={page} />}
        {tab === "health" && <HealthTab />}
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
              <span className="text-xs text-muted">
                by {proposer ?? proposerSlack ?? "someone"} · {formatDate(p.createdAt)}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {p.category && <Chip>{p.category}</Chip>}
            {p.closesAt && <Chip>Closes {p.closesAt.toLocaleString("en-US")}</Chip>}
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

async function SettlementsTab({ me }: { me: SessionUser }) {
  const rows = await pendingSettlements();
  if (!rows.length) return <Empty>Nothing ripening.</Empty>;
  return (
    <div className="space-y-3">
      {rows.map(({ s, wheel, proposer, wedgeLabel, preview }) => {
        const result =
          s.outcome === "moldy"
            ? "Moldy: every share pays ʟ0.50"
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
            href={`/cheesemongers?tab=users${x === "all" ? "" : `&filter=${x}`}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
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
          {rows.map(({ u, balance, funder }) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Avatar slackId={u.slackId} name={u.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  {u.name ?? (u.hcaSub ? "Hack Clubber" : u.slackId)}
                  {!u.hcaSub && <Badge>Not signed up</Badge>}
                  {u.isCheesemonger && <Badge tone="accent">Cheesemonger</Badge>}
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
                  {u.hackatimeUserId ? `Hackatime #${u.hackatimeUserId}` : "Hackatime not linked"} · joined {formatDate(u.createdAt)}
                  {u.suspendedAt && u.suspendReason && <span className="text-no"> · “{u.suspendReason}”</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {u.id !== me.id &&
                  (u.suspendedAt ? (
                    <ReasonAction action={unsuspendUserAction.bind(null, u.id)} label="Unsuspend" placeholder="Note (optional)" optional />
                  ) : (
                    !u.isCheesemonger && (
                      <ReasonAction action={suspendUserAction.bind(null, u.id)} label="Suspend" placeholder="Reason (shown to them)" danger />
                    )
                  ))}
                {!u.suspendedAt && u.id !== me.id && (
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
  "churn.run": "ran Churn",
};

async function LogsTab({ action, page }: { action?: string; page: number }) {
  const { rows, total } = await auditLogPage({ action, page });
  const filters = ["", "proposal", "settlement", "wheel", "user", "funder", "churn"];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {filters.map((f) => (
          <Link
            key={f || "all"}
            href={`/cheesemongers?tab=logs${f ? `&action=${f}.` : ""}`}
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
            <CheckIcon size={15} className="text-yes" /> Ledger audit clean: every Latta is accounted for and every share is backed.
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
        . Past runs that paid anything are in the <Link href="/cheesemongers?tab=logs&action=churn." className="underline">logs</Link>.
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
    <form action="/cheesemongers" className="mb-3">
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
    return `/cheesemongers?${params}`;
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
