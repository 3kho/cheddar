import Link from "next/link";
import { MouseIcon } from "@/components/Icons";
import { Avatar, WheelIcon } from "@/components/Logo";
import { formatLatta, formatShares, timeAgo } from "@/lib/format";
import { globalActivity } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity · Cheddar" };

const MIN_FILTERS = [
  { key: "0", label: "Any amount", ticks: 0 },
  { key: "10", label: "ʟ10+", ticks: 1_000 },
  { key: "100", label: "ʟ100+", ticks: 10_000 },
  { key: "1000", label: "ʟ1,000+", ticks: 100_000 },
] as const;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ min?: string }> }) {
  const { min } = await searchParams;
  const filter = MIN_FILTERS.find((f) => f.key === min) ?? MIN_FILTERS[0];
  const rows = await globalActivity({ limit: 80, minTicks: filter.ticks });
  const now = Date.now();

  return (
    <div className="mx-auto mt-4 max-w-[1000px]">
      <div className="my-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] font-medium leading-9 tracking-[-0.01em]">Activity</h1>
        <details className="relative">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-[10px] border border-line px-3 text-sm font-semibold hover:bg-hover [&::-webkit-details-marker]:hidden">
            <span className="text-muted">Min amount:</span> {filter.label}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl bg-surface py-1 shadow-pop">
            {MIN_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "0" ? "/activity" : `/activity?min=${f.key}`}
                aria-current={f.key === filter.key ? "page" : undefined}
                className={`block px-3.5 py-2 text-sm font-medium hover:bg-hover ${f.key === filter.key ? "text-ink" : "text-muted"}`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </details>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted">No trades{filter.ticks ? " this size" : ""} yet.</p>
      ) : (
        <ul>
          {rows.map((a) => {
            const total = a.price * a.qty;
            return (
              <li key={a.id} className="group/row relative border-b border-line">
                <span className="pointer-events-none absolute -inset-x-1 inset-y-1 rounded-xl transition-colors group-hover/row:bg-hover" aria-hidden="true" />
                <div className="relative flex items-center gap-3 p-4 max-sm:px-1">
                  <Link href={`/wheel/${a.wheelSlug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
                    <WheelIcon icon={a.icon} category={a.category} size={48} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/wheel/${a.wheelSlug}`} className="block truncate text-sm text-muted hover:underline">
                      {a.wheelTitle}
                    </Link>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                      <Avatar slackId={a.slackId} name={a.name} size={24} />
                      <span className="font-semibold">{a.name ?? "Someone"}</span>
                      <span className="text-muted">{a.side === "BUY" ? "bought" : "sold"}</span>
                      <span className={`font-semibold ${a.outcome === "YES" ? "text-yes" : "text-no"}`}>
                        {formatShares(a.qty)} {a.outcome === "YES" ? "Yes" : "No"}
                        {!a.binary && ` · ${a.wedgeLabel}`}
                      </span>
                      <span className="tabular text-muted">
                        at {a.price}¢ ({formatLatta(total)})
                      </span>
                      {a.counterpartyIsBot && (
                        <span className="inline-flex items-center gap-1 text-muted">
                          {a.side === "BUY" ? "from" : "to"} <MouseIcon size={13} /> The Mouse
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 self-start text-sm text-muted sm:self-center">{timeAgo(a.at, now)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
