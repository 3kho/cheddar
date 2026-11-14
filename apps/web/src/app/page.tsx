import Link from "next/link";
import { redirect } from "next/navigation";
import { FeaturedCarousel } from "@/components/FeaturedCarousel";
import { FeaturedWheel } from "@/components/FeaturedWheel";
import type { TickerTrade } from "@/components/TradeTicker";
import { Change, CheeseIcon, SearchIcon } from "@/components/Icons";
import { WheelIcon } from "@/components/Logo";
import type { Series } from "@/components/PriceChart";
import { GettingStarted } from "@/components/GettingStarted";
import { WheelCard } from "@/components/WheelCard";
import { onboardingState } from "@/lib/profile";
import { formatChance, formatLatta, timeAgo } from "@/lib/format";
import { getWheel, listCategories, listWheels, wheelActivity, type WheelSort, type WheelView } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const SORTS: Record<string, { sort: WheelSort; title: string }> = {
  trending: { sort: "trending", title: "Trending" },
  new: { sort: "new", title: "New" },
  closing: { sort: "closing", title: "Closing soon" },
  mine: { sort: "trending", title: "My wheels" },
  resolved: { sort: "resolved", title: "Resolved" },
};

/** How many wheels slide through the big card, and how many recent trades each one's ticker holds. */
const FEATURED_COUNT = 4;
const TICKER_TRADES = 8;

const top = (w: WheelView) => [...w.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1))[0];

export default async function Home({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; sort?: string }> }) {
  const { c, q, sort } = await searchParams;
  const mode = SORTS[sort ?? "trending"] ?? SORTS.trending!;
  const query = q?.trim() || undefined;
  const user = await currentUser();
  const onboarding = user && !user.isMouseFunder ? await onboardingState(user.id) : null;
  const front0Done = !onboarding || onboarding.traded;
  if (sort === "mine" && !user) redirect("/api/auth/login?returnTo=/%3Fsort%3Dmine");
  const [wheels, categories] = await Promise.all([
    listWheels({ category: c, q: query, sort: mode.sort, heldBy: sort === "mine" ? user?.id : undefined }),
    listCategories(),
  ]);

  // Feature the hottest wheel, with movers and hot categories beside it, on the plain front page only.
  const front = !c && !query && mode.sort === "trending" && sort !== "mine";
  // The hottest few wheels slide through the big card, each with its latest trades scrolling by.
  const featuredWheels = front ? wheels.filter((w) => w.volumeTicks > 0).slice(0, FEATURED_COUNT) : [];
  const featured = featuredWheels[0] ?? null;
  const featuredIds = new Set(featuredWheels.map((w) => w.id));
  const now = Date.now();
  const slides = await Promise.all(
    featuredWheels.map(async (fw) => {
      const [full, activity] = await Promise.all([getWheel(fw.slug), wheelActivity(fw.wedges.map((w) => w.id), TICKER_TRADES)]);
      const ranked = [...fw.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1)).slice(0, 4);
      const series: Series[] = ranked.map((w) => ({
        label: w.label,
        chance: w.chance,
        points: (full?.history ?? []).filter((h) => h.wedgeId === w.id).map((h) => ({ t: h.at.getTime(), p: h.yesPrice })),
      }));
      const labels = new Map(fw.wedges.map((w) => [w.id, w.label]));
      const trades: TickerTrade[] = activity.map((a) => ({
        id: a.id,
        who: a.name ?? "Someone",
        side: a.side,
        outcome: a.outcome,
        qty: a.qty,
        price: a.price,
        label: fw.wedges.length > 1 ? (labels.get(a.wedgeId) ?? null) : null,
        ago: timeAgo(a.at, now),
      }));
      return { wheel: fw, series, trades };
    }),
  );
  const movers = featured
    ? wheels
        .filter((w) => !featuredIds.has(w.id) && top(w)?.change24h)
        .sort((a, b) => Math.abs(top(b)!.change24h!) - Math.abs(top(a)!.change24h!))
        .slice(0, 4)
    : [];
  const hot = featured
    ? Object.entries(
        wheels.reduce<Record<string, number>>((m, w) => {
          if (w.category) m[w.category] = (m[w.category] ?? 0) + w.volumeTicks;
          return m;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  const heading = query ? `Results for “${query}”` : c ? c : front ? "All markets" : mode.title;
  const sortQs = !sort || sort === "trending" ? "" : `sort=${sort}&`;

  return (
    <div>
      <form action="/" role="search" className="relative mb-5 md:hidden">
        <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search wheels"
          aria-label="Search wheels"
          className="h-10 w-full rounded-[12px] bg-surface-2 pl-10 pr-3 text-sm font-medium outline-none placeholder:text-muted/70 focus:ring-3 focus:ring-surface-2"
        />
      </form>

      {user && !user.isMouseFunder && !front0Done && <GettingStarted user={user} state={onboarding} />}

      {featured && (
        <div className="mb-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_362px]">
          <FeaturedCarousel>
            {slides.map((s) => (
              <FeaturedWheel key={s.wheel.id} wheel={s.wheel} series={s.series} now={now} trades={s.trades} />
            ))}
          </FeaturedCarousel>
          <aside className="flex flex-col gap-6">
            {movers.length > 0 && (
              <section>
                <h2 className="mb-1 text-base font-semibold">Top movers</h2>
                <ul>
                  {movers.map((w) => {
                    const t = top(w)!;
                    return (
                      <li key={w.id}>
                        <Link href={`/wheel/${w.slug}`} className="group/m flex items-center gap-3 py-2.5">
                          <WheelIcon icon={w.icon} category={w.category} size={32} />
                          <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-[18px] group-hover/m:underline">
                            {w.title}
                            {w.wedges.length > 1 && <span className="text-muted"> · {t.label}</span>}
                          </span>
                          <span className="flex shrink-0 flex-col items-end">
                            <span className="tabular text-lg font-semibold leading-6">{formatChance(t.chance)}</span>
                            <Change value={t.change24h} className="text-xs" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {hot.length > 0 && (
              <section className={movers.length ? "border-t border-dashed border-line pt-5" : ""}>
                <h2 className="mb-1 text-base font-semibold">Hot categories</h2>
                <ol>
                  {hot.map(([name, vol], i) => (
                    <li key={name}>
                      <Link href={`/?c=${encodeURIComponent(name)}`} className="group/h flex items-center gap-3 py-2 text-sm">
                        <span className="tabular w-4 text-faint">{i + 1}</span>
                        <WheelIcon category={name} size={24} />
                        <span className="flex-1 font-medium group-hover/h:underline">{name}</span>
                        <span className="tabular text-[13px] text-muted">{formatLatta(vol, { compact: true })} Vol.</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </div>
      )}

      {wheels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <CheeseIcon size={44} strokeWidth={1.5} className="mx-auto text-accent" />
          <h2 className="mt-3 text-lg font-semibold">
            {query || c
              ? "Nothing matches that"
              : sort === "mine"
                ? "You don't hold anything yet"
                : sort === "closing"
                  ? "Nothing has a close date coming up"
                  : mode.sort === "resolved"
                    ? "Nothing has ripened yet"
                    : "No wheels on the board yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Wheels are questions about what happens next in Hack Club. Anyone can propose one; a Cheesemonger approves it.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {(query || c) && (
              <Link href="/" className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold hover:bg-hover">
                Clear filters
              </Link>
            )}
            <Link
              href={user ? "/propose" : "/api/auth/login?returnTo=/propose"}
              className="rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Propose a wheel
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.01em]">{heading}</h2>
            {(query || c) && (
              <Link href="/" className="text-sm font-medium text-muted hover:text-ink">
                Clear
              </Link>
            )}
          </div>
          {!query && categories.length > 0 && (
            <nav className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1" aria-label="Topics">
              <Chip href={mode.sort === "trending" ? "/" : `/?sort=${mode.sort}`} active={!c}>
                All
              </Chip>
              {categories.map((x) => (
                <Chip key={x} href={`/?${sortQs}c=${encodeURIComponent(x)}`} active={c === x}>
                  {x}
                </Chip>
              ))}
            </nav>
          )}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {wheels
              .filter((w) => w.id !== featured?.id)
              .map((w) => (
                <WheelCard key={w.id} wheel={w} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 shrink-0 items-center rounded-[12px] px-3 text-sm font-semibold transition-colors ${
        active ? "bg-surface-2 text-ink" : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
