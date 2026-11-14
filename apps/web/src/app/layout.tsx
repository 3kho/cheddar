import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { CheeseIcon, MouseIcon } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { themeScript } from "@/components/ThemeToggle";
import { currentUser } from "@/lib/session";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Cheddar",
  description: "Hack Club's prediction market. Trade Latta Cheese on what happens next.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
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
        {user && !user.isMouseFunder && !user.hackatimeUserId && (
          <div className="border-b border-line bg-accent-soft">
            <p className="mx-auto flex max-w-[1350px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span>
                <CheeseIcon size={15} className="mr-1.5 inline-block align-[-3px] text-accent" />
                <strong>Link Hackatime to start earning.</strong> Every hour of non-AI coding churns into 10 Latta Cheese (Lc).
              </span>
              <a href="/api/hackatime/start" className="font-semibold underline underline-offset-2">
                Link Hackatime →
              </a>
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
              <Link href="/propose" className="hover:text-ink">Propose a wheel</Link>
              <Link href="/portfolio" className="hover:text-ink">Portfolio</Link>
            </nav>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
