import Link from "next/link";
import { Suspense } from "react";
import { balancesOf, listCategories, portfolioValue } from "@/lib/queries";
import { formatLatta } from "@/lib/format";
import type { SessionUser } from "@/lib/session";
import { CategoryBar } from "./CategoryBar";
import { ActivityIcon, CheeseIcon, LattaCoin, PlusIcon, SearchIcon, TrophyIcon } from "./Icons";
import { Avatar, Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export async function Nav({ user }: { user: SessionUser | null }) {
  const [bal, positions, categories] = await Promise.all([
    user ? balancesOf(user.id) : null,
    user ? portfolioValue(user.id) : 0,
    listCategories(),
  ]);
  const total = bal ? bal.available + bal.locked + positions : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-[1350px] items-center gap-4 px-4 lg:grid lg:grid-cols-[minmax(max-content,1fr)_minmax(0,30rem)_minmax(max-content,1fr)] lg:gap-12 lg:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-[19px] font-bold tracking-tight">
          <Logo size={28} />
          <span>Cheddar</span>
        </Link>

        <form action="/" role="search" className="group relative hidden min-w-0 flex-1 md:block lg:w-full">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            name="q"
            placeholder="Search wheels"
            aria-label="Search wheels"
            className="h-10 w-full rounded-[12px] border border-transparent bg-surface-2 pl-10 pr-3 text-sm font-medium outline-none transition placeholder:text-muted/70 focus:border-line focus:bg-bg focus:ring-3 focus:ring-surface-2"
          />
        </form>

        <nav className="ml-auto flex items-center gap-1 justify-self-end text-sm">
          <Link href="/activity" className="hidden items-center gap-1.5 rounded-[10px] px-2.5 py-2 font-semibold text-muted hover:bg-hover hover:text-ink xl:flex">
            <ActivityIcon size={16} /> Activity
          </Link>
          <Link href="/leaderboard" className="hidden items-center gap-1.5 rounded-[10px] px-2.5 py-2 font-semibold text-muted hover:bg-hover hover:text-ink xl:flex">
            <TrophyIcon size={16} /> Leaderboard
          </Link>
          {user?.isSuperAdmin && (
            <Link href="/admin" className="hidden rounded-[10px] px-2.5 py-2 font-semibold text-muted hover:bg-hover hover:text-ink xl:block">
              Super admin
            </Link>
          )}
          {user?.isCheesemonger && (
            <Link href="/cheesemongers" className="hidden rounded-[10px] px-2.5 py-2 font-semibold text-muted hover:bg-hover hover:text-ink xl:block">
              <span className="flex items-center gap-1.5">
                <CheeseIcon size={16} /> Cheesemongers
              </span>
            </Link>
          )}
          {user ? (
            <>
              <Link href="/portfolio" className="mx-1 hidden items-center gap-3 rounded-[10px] px-2 py-1 hover:bg-hover sm:flex">
                <NavStat label="Portfolio" value={formatLatta(total)} />
                <NavStat label="Cash" value={formatLatta(bal!.available)} />
              </Link>
              <Link
                href="/propose"
                className="hidden h-8 items-center gap-1 rounded-[10px] bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover sm:flex"
              >
                <PlusIcon size={15} /> Propose
              </Link>
              <ThemeToggle />
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center rounded-full p-0.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <Avatar slackId={user.slackId} name={user.name} size={30} />
                </summary>
                <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl bg-surface py-1 shadow-pop">
                  <div className="border-b border-line px-3.5 py-3">
                    <div className="text-sm font-semibold">{user.name ?? "Hack Clubber"}</div>
                    <div className="tabular mt-0.5 text-xs text-muted">
                      Portfolio {formatLatta(total)} · Cash {formatLatta(bal!.available)}
                    </div>
                  </div>
                  <MenuLink href="/portfolio">Portfolio</MenuLink>
                  <MenuLink href="/profile">Edit profile</MenuLink>
                  <MenuLink href="/propose">Propose a wheel</MenuLink>
                  <MenuLink href="/activity">Activity</MenuLink>
                  <MenuLink href="/leaderboard">Leaderboard</MenuLink>
                  {user.isCheesemonger && <MenuLink href="/cheesemongers">Cheesemongers</MenuLink>}
                  {user.isSuperAdmin && <MenuLink href="/admin">Super admin</MenuLink>}
                  <form action="/api/auth/logout" method="post" className="mt-1 border-t border-line pt-1">
                    <button className="w-full px-3.5 py-2 text-left text-sm text-muted hover:bg-hover hover:text-ink">Log out</button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <ThemeToggle />
              <a
                href="/api/auth/login"
                className="flex h-8 items-center rounded-[10px] bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                Log in
              </a>
            </>
          )}
        </nav>
      </div>
      <Suspense fallback={<div className="h-12" />}>
        <CategoryBar categories={categories} />
      </Suspense>
    </header>
  );
}

function NavStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-start leading-tight">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular flex items-center gap-1 text-sm font-semibold text-yes">
        <LattaCoin size={14} />
        {value}
      </span>
    </span>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block px-3.5 py-2 text-sm font-medium hover:bg-hover">
      {children}
    </Link>
  );
}
