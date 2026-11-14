import Link from "next/link";
import { formatChance, formatDate, formatLatta } from "@/lib/format";
import type { WheelView } from "@/lib/queries";
import { Change, ClockIcon } from "./Icons";
import { WheelIcon } from "./Logo";
import { PriceChart, type Series } from "./PriceChart";
import { TradeTicker, type TickerTrade } from "./TradeTicker";

/** The big card at the top of the home page: the hottest wheel, its outcomes and its chart. */
export function FeaturedWheel({
  wheel,
  series,
  now,
  trades,
}: {
  wheel: WheelView;
  series: Series[];
  now: number;
  trades: TickerTrade[];
}) {
  const href = `/wheel/${wheel.slug}`;
  const binary = wheel.wedges.length === 1;
  const w0 = wheel.wedges[0]!;
  const ranked = [...wheel.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1)).slice(0, 4);
  return (
    <section className="flex min-h-[420px] flex-col rounded-[18px] bg-surface p-5 pb-4 shadow-mid">
      <header className="flex items-center gap-4">
        <WheelIcon icon={wheel.icon} category={wheel.category} size={56} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-muted">{wheel.category ?? "Cheddar"}</div>
          <Link href={href} className="line-clamp-2 text-xl font-semibold leading-7 tracking-[-0.015em] hover:underline sm:text-2xl">
            {wheel.title}
          </Link>
        </div>
      </header>

      <div className="mt-5 flex flex-1 flex-col gap-6 md:flex-row">
        <div className="flex flex-col md:w-[40%]">
          {binary ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="tabular text-[32px] font-semibold leading-9" style={{ color: "var(--chart-binary)" }}>
                  {formatChance(w0.chance)}
                </span>
                <span className="text-sm font-medium text-muted">chance</span>
                <Change value={w0.change24h} className="text-xs" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Link href={`${href}?w=${w0.id}&o=YES`} className="btn-3d flex h-12 items-center justify-center gap-1.5 bg-yes-solid font-semibold text-white">
                  <span className="opacity-80">Buy Yes</span>
                  {w0.bestAsk != null && <span className="tabular text-base">{w0.bestAsk}¢</span>}
                </Link>
                <Link href={`${href}?w=${w0.id}&o=NO`} className="btn-3d flex h-12 items-center justify-center gap-1.5 bg-no-solid font-semibold text-white">
                  <span className="opacity-80">Buy No</span>
                  {w0.bestBid != null && <span className="tabular text-base">{100 - w0.bestBid}¢</span>}
                </Link>
              </div>
            </>
          ) : (
            <ul>
              {ranked.map((w) => (
                <li key={w.id} className="border-b border-surface-2 py-1.5 last:border-0">
                  <Link href={`${href}?w=${w.id}&o=YES`} className="group/row flex min-h-10 items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-[450] tracking-[-0.01em] group-hover/row:underline">{w.label}</span>
                    <Change value={w.change24h} className="text-xs" />
                    <span className="tabular text-xl font-semibold">{formatChance(w.chance)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto pt-4">
            <TradeTicker trades={trades} />
            <p className="mt-3 line-clamp-3 text-[13px] leading-5 text-muted">{wheel.description || wheel.resolutionCriteria}</p>
          </div>
        </div>
        <div className="min-w-0 md:w-[60%]">
          <PriceChart series={series} now={now} height={230} compact />
        </div>
      </div>

      <footer className="mt-3 flex items-center gap-3 text-[13px] text-faint">
        <span className="tabular">{formatLatta(wheel.volumeTicks, { compact: true })} Vol.</span>
        {wheel.closesAt && (
          <span className="flex items-center gap-1">
            <ClockIcon size={13} /> Ends {formatDate(wheel.closesAt)}
          </span>
        )}
      </footer>
    </section>
  );
}
