import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { CategoryIconsProvider } from "@/components/CategoryIcons";
import { NavigationProgress } from "@/components/NavigationProgress";
import { CheeseIcon, MouseIcon } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { themeScript } from "@/components/ThemeToggle";
import { after } from "next/server";
import { hackatimeStatus, syncNow } from "@/lib/accounts";
import { env } from "@/lib/env";
import { categoryIcons } from "@/lib/queries";
import { currentUser } from "@/lib/session";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const DESCRIPTION =
  "Hack Club's play-money prediction market. Trade YES/NO on what happens next with Latta Cheese, earned by coding on Hackatime. No cash value.";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: "Cheddar · Hack Club's prediction market",
  description: DESCRIPTION,
  applicationName: "Cheddar",
  openGraph: {
    type: "website",
    siteName: "Cheddar",
    title: "Cheddar · Hack Club's prediction market",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Cheddar · Hack Club's prediction market",
    description: DESCRIPTION,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, catIcons] = await Promise.all([currentUser(), categoryIcons()]);
  // The scheduled sweep only runs daily on Vercel's free plan, so top people up whenever they show
  // up (at most once every few minutes, see SYNC_COOLDOWN_MS), after the page has been sent.
  if (user && (user.slackId || user.hackatimeUserId)) {
    const id = user.id;
    after(async () => {
      try {
        await syncNow(id);
      } catch (e) {
        console.error(e);
      }
    });
  }
  const hk = user && !user.isMouseFunder ? await hackatimeStatus(user) : null;
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <CategoryIconsProvider icons={catIcons}>
        <Nav user={user} />
        {user?.isSuspended && (
          <div className="border-b border-line bg-no-soft">
            <p className="mx-auto max-w-[1350px] px-4 py-2.5 text-sm">
              <strong>Your account is suspended by the Cheesemongers.</strong> You can browse, but not trade or propose.
              {user.suspendReason && <> Reason: “{user.suspendReason}”.</>} Ask in Slack if you think this is a mistake.
            </p>
          </div>
        )}
        {user?.isMouseFunder && (
          <div className="border-b border-line bg-accent-soft">
            <p className="mx-auto max-w-[1350px] px-4 py-2.5 text-sm">
              <MouseIcon size={15} className="mr-1.5 inline-block align-[-3px]" />
              <strong>You&apos;re feeding The Mouse.</strong> As Hack Club staff, your coding hours fund Cheddar&apos;s
              market maker instead of your balance, so you can browse but not trade. Thanks for keeping the markets alive!
            </p>
          </div>
        )}
        {user && !user.hasSeenTour && (
          <div className="border-b border-line bg-accent-soft">
            <p className="mx-auto flex max-w-[1350px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span>
                <strong>New here? Take the 2-minute tour</strong> of how Cheddar works.
              </span>
              <Link href="/how-it-works" className="font-semibold underline underline-offset-2">
                Start the tour
              </Link>
            </p>
          </div>
        )}
        {user && !user.hasAcceptedFairPlay && (
          <div className="border-b border-line bg-accent-soft">
            <p className="mx-auto flex max-w-[1350px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span>
                <strong>Read the fair play rules to start trading.</strong> Insider trading is strictly prohibited.
              </span>
              <Link href="/welcome" className="font-semibold underline underline-offset-2">
                Review &amp; accept →
              </Link>
            </p>
          </div>
        )}
        {hk && hk !== "linked" && hk !== "ok" && hk !== "unknown" && (
          <div className="border-b border-line bg-accent-soft">
            <p className="mx-auto flex max-w-[1350px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span>
                <CheeseIcon size={15} className="mr-1.5 inline-block align-[-3px] text-accent" />
                {hk === "private" && (
                  <>
                    <strong>We can&apos;t see your Hackatime hours.</strong> Your stats are private. Make them public in Hackatime&apos;s settings
                    and your Latta shows up within a few hours, or link your account instead.
                  </>
                )}
                {hk === "not_found" && (
                  <>
                    <strong>No Hackatime coding found for your Slack account yet.</strong> Every hour of non-AI coding turns into 10 Latta Cheese
                    (Lc). Already use Hackatime with a different account? Link it.
                  </>
                )}
                {hk === "no_slack" && (
                  <>
                    <strong>Link Hackatime to start earning.</strong> Your Hack Club account has no Slack ID, so we can&apos;t find your hours
                    automatically.
                  </>
                )}
              </span>
              <span className="flex items-center gap-3">
                {hk === "private" && (
                  <a href="https://hackatime.hackclub.com/my/settings" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                    Hackatime settings ↗
                  </a>
                )}
                {hk === "not_found" && (
                  <a href="https://hackatime.hackclub.com" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                    Get started with Hackatime ↗
                  </a>
                )}
                <a href="/api/hackatime/start" className="font-semibold underline underline-offset-2">
                  Link Hackatime →
                </a>
              </span>
            </p>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1350px] flex-1 px-4 pb-12 pt-6 lg:px-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1350px] flex-col gap-4 px-4 py-10 text-[13px] text-muted sm:flex-row sm:items-start sm:justify-between lg:px-6">
            <div className="max-w-md">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
                <Logo size={20} /> Cheddar
              </div>
              A play-money prediction market for the Hack Club community. Latta Cheese has no cash value and can&apos;t be bought or
              withdrawn.
            </div>
            <nav className="grid grid-cols-2 gap-x-12 gap-y-2 font-medium sm:grid-cols-3" aria-label="Footer">
              <Link href="/" className="hover:text-ink">Markets</Link>
              <Link href="/?sort=resolved" className="hover:text-ink">Resolved</Link>
              <Link href="/activity" className="hover:text-ink">Activity</Link>
              <Link href="/leaderboard" className="hover:text-ink">Leaderboard</Link>
              <Link href="/how-it-works" className="hover:text-ink">How it works</Link>
              <Link href="/propose" className="hover:text-ink">Propose a wheel</Link>
              <Link href="/portfolio" className="hover:text-ink">Portfolio</Link>
              <Link href="/privacy" className="hover:text-ink">Privacy</Link>
              <Link href="/terms" className="hover:text-ink">Terms</Link>
              <Link href="/credits" className="hover:text-ink">Credits</Link>
            </nav>
          </div>
        </footer>
        </CategoryIconsProvider>
        <Analytics />
      </body>
    </html>
  );
}
