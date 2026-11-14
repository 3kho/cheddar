"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { finishTourAction } from "@/lib/actions";
import { safely } from "@/lib/safely";

/* ------------------------------------------------------------------ visuals */

const lc = (n: number) => `${n.toFixed(2)} Lc`;

/** A tiny copy of a wheel card, so the words below it have something to point at. */
function MockWheel() {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-mid">
      <div className="text-xs font-semibold text-muted">Hack Club</div>
      <div className="mt-0.5 text-base font-semibold leading-6">Will #ship get 1,000 posts in December?</div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold text-primary">64%</span>
        <span className="text-sm font-medium text-muted">chance</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-yes-solid text-sm font-semibold text-white">
          Buy Yes <span className="tabular">64c</span>
        </div>
        <div className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-no-solid text-sm font-semibold text-white">
          Buy No <span className="tabular">36c</span>
        </div>
      </div>
    </div>
  );
}

function Callout({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-accent-soft px-3 py-2 text-sm ${className}`}>{children}</div>;
}

function PriceBar() {
  return (
    <div>
      <div className="flex h-12 overflow-hidden rounded-xl text-sm font-semibold text-white">
        <div className="flex items-center justify-center bg-yes-solid" style={{ width: "65%" }}>
          Yes 65c
        </div>
        <div className="flex items-center justify-center bg-no-solid" style={{ width: "35%" }}>
          No 35c
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>0c</span>
        <span>Yes and No always add up to 100c</span>
        <span>100c</span>
      </div>
    </div>
  );
}

/** Slide the price and watch what a bet on Yes would win or lose. */
function PayoffPlayground() {
  const [price, setPrice] = useState(40);
  const shares = 10;
  const cost = (shares * price) / 100;
  const win = shares - cost;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="tour-price" className="flex items-baseline justify-between text-sm font-semibold">
          <span>Price of Yes</span>
          <span className="tabular text-lg">{price}c</span>
        </label>
        <input
          id="tour-price"
          type="range"
          min={5}
          max={95}
          step={5}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="mt-1 w-full accent-[var(--primary)]"
        />
        <p className="text-xs text-muted">Say you buy {shares} shares of Yes at this price. Drag to try different prices.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-yes-soft p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">If it happens</div>
          <div className="tabular mt-1 text-xl font-semibold text-yes">+{lc(win)}</div>
          <div className="text-xs text-muted">
            Your {shares} shares pay {lc(shares)}. You paid {lc(cost)}.
          </div>
        </div>
        <div className="rounded-xl bg-no-soft p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">If it doesn&apos;t</div>
          <div className="tabular mt-1 text-xl font-semibold text-no">-{lc(cost)}</div>
          <div className="text-xs text-muted">Your shares pay nothing. You lose what you paid.</div>
        </div>
      </div>
      <p className="text-sm text-muted">
        {price <= 25
          ? "A low price is a long shot: a big win if you're right, but you probably won't be."
          : price >= 75
            ? "A high price is a safe bet: you're likely right, but the win is small."
            : "A middle price is a toss-up: a fair win for a fair risk."}
      </p>
    </div>
  );
}

/** A price line that goes up after you buy, with the sell point marked. */
function SellChart() {
  const pts: [number, number][] = [
    [0, 62], [10, 60], [20, 58], [30, 52], [40, 55], [50, 44], [60, 36], [70, 30], [80, 26], [90, 22], [100, 20],
  ];
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x * 3},${y * 1.4}`).join(" ");
  return (
    <div className="rounded-xl bg-surface p-3 shadow-mid">
      <svg viewBox="0 0 300 100" className="h-40 w-full text-primary" role="img" aria-label="A price rising from 40 cents to 70 cents">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={30} cy={pts[3]![1] * 1.4} r="5" fill="var(--yes-solid, #16a34a)" />
        <circle cx={270} cy={pts[9]![1] * 1.4} r="5" fill="var(--no-solid, #dc2626)" />
      </svg>
      <div className="mt-1 flex justify-between text-xs font-semibold">
        <span className="text-yes">You buy at 40c</span>
        <span className="text-no">You sell at 70c</span>
      </div>
      <div className="mt-1 text-center text-xs text-muted">Profit: 30c on every share, with no waiting for the result.</div>
    </div>
  );
}

function MockNav() {
  const chip = "rounded-lg px-2.5 py-1.5 text-left";
  return (
    <div className="rounded-xl bg-surface p-3 shadow-mid">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">Cheddar</span>
        <span className="flex-1" />
        <span className={`${chip} bg-accent-soft`}>
          <span className="block text-[11px] text-muted">Portfolio</span>
          <span className="tabular font-semibold text-yes">312.50 Lc</span>
        </span>
        <span className={`${chip} bg-accent-soft`}>
          <span className="block text-[11px] text-muted">Cash</span>
          <span className="tabular font-semibold text-yes">120.00 Lc</span>
        </span>
        <span className="rounded-[10px] bg-primary px-3 py-2 font-semibold text-white">Propose</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-muted">
        <li>
          <strong className="text-ink">Cash</strong> is what you can spend right now.
        </li>
        <li>
          <strong className="text-ink">Portfolio</strong> is your cash plus what your shares are worth today.
        </li>
        <li>
          <strong className="text-ink">Propose</strong> lets you suggest a new wheel.
        </li>
      </ul>
    </div>
  );
}

function MockTabs() {
  const tabs: [string, string][] = [
    ["Trending", "What people are trading most right now"],
    ["New", "The newest wheels"],
    ["Closing soon", "Wheels about to end"],
    ["My wheels", "Everything you hold shares in"],
    ["Resolved", "Finished wheels and their results"],
  ];
  return (
    <div className="rounded-xl bg-surface p-3 shadow-mid">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-sm font-semibold">
        {tabs.map(([t], i) => (
          <span key={t} className={i === 0 ? "text-ink" : "text-muted"}>
            {t}
          </span>
        ))}
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        {tabs.map(([t, d]) => (
          <div key={t} className="flex gap-2">
            <dt className="w-28 shrink-0 font-semibold">{t}</dt>
            <dd className="text-muted">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Timeline() {
  const steps: [string, string][] = [
    ["Open", "People trade. Prices move."],
    ["Closed", "The deadline passes, or someone asks to close it."],
    ["Ripening", "A Cheesemonger checks the proof for the result."],
    ["Paid out", "Winning shares pay 1 Lc each. Losing shares pay 0."],
  ];
  return (
    <ol className="space-y-0">
      {steps.map(([t, d], i) => (
        <li key={t} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-bg">{i + 1}</span>
            {i < steps.length - 1 && <span className="my-0.5 w-0.5 flex-1 bg-surface-3" />}
          </div>
          <div className="pb-4 text-sm">
            <div className="font-semibold">{t}</div>
            <div className="text-muted">{d}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------- steps */

interface Step {
  title: string;
  body: React.ReactNode;
  visual: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Guess what happens next",
    body: (
      <>
        <p>
          Cheddar is a game where you bet on what happens in Hack Club. Each question is called a <strong>wheel</strong>, like the one on the right.
        </p>
        <p>You play with <strong>Latta Cheese (Lc)</strong>. It&apos;s play money: it has no cash value and you can&apos;t buy or withdraw it.</p>
      </>
    ),
    visual: <MockWheel />,
  },
  {
    title: "The price is the chance",
    body: (
      <>
        <p>
          Every wheel has a <strong>Yes</strong> price and a <strong>No</strong> price. The Yes price is how likely the crowd thinks it is.
        </p>
        <p>
          Yes at 65c means about a 65% chance. When people buy Yes, the price goes up. When they buy No, it goes down. So the price is the
          crowd&apos;s best guess, and you can try to beat it.
        </p>
      </>
    ),
    visual: <PriceBar />,
  },
  {
    title: "How you win (or lose)",
    body: (
      <>
        <p>
          You buy <strong>shares</strong>. Each share pays <strong>1 Lc</strong> if you&apos;re right and <strong>0</strong> if you&apos;re wrong.
        </p>
        <p>
          So buying Yes at 40c costs 0.40 Lc a share, and pays 1 Lc if it happens. Cheap shares win big but often lose. Expensive ones win small but
          usually pay out.
        </p>
      </>
    ),
    visual: <PayoffPlayground />,
  },
  {
    title: "You don't have to wait",
    body: (
      <>
        <p>
          You can <strong>sell</strong> your shares any time, at the current price. If the price moves your way after you buy, you can cash out
          early and keep the difference.
        </p>
        <p>
          A <strong>market order</strong> trades right now at the best price on offer. A <strong>limit order</strong> lets you pick your price and
          wait for someone to match it.
        </p>
      </>
    ),
    visual: <SellChart />,
  },
  {
    title: "Where your Latta comes from",
    body: (
      <>
        <p>
          You earn Latta by coding. Every hour of <strong>non-AI coding</strong> on Hackatime turns into <strong>10 Lc</strong>, which shows up in
          your Cash.
        </p>
        <p>
          We find your hours through your Slack account, so there&apos;s nothing to link. If your Hackatime stats are private, we&apos;ll tell you at the
          top of the page.
        </p>
      </>
    ),
    visual: <MockNav />,
  },
  {
    title: "Find your way around",
    body: (
      <>
        <p>The bar under the header sorts every wheel. Use it to find something you know about, or something about to end.</p>
        <p>
          Spot a question that isn&apos;t on the board? <strong>Propose a wheel</strong>. A Cheesemonger checks it before it goes live. The{" "}
          <strong>Leaderboard</strong> and <strong>Activity</strong> pages show who&apos;s winning and what&apos;s being traded.
        </p>
      </>
    ),
    visual: <MockTabs />,
  },
  {
    title: "How a wheel ends",
    body: (
      <>
        <p>When a wheel closes, a Cheesemonger checks the proof for the result before anyone is paid, so it&apos;s never just one person&apos;s call.</p>
        <p>
          Some wheels have several outcomes. Exactly one wins, and an <strong>Other</strong> outcome catches anything nobody listed. If a wheel
          turns out to be unresolvable, it&apos;s voided and every share is refunded at 0.50 Lc.
        </p>
      </>
    ),
    visual: <Timeline />,
  },
];

/* ---------------------------------------------------------------- component */

export function Tour({
  loggedIn,
  alreadyDone,
  next,
}: {
  loggedIn: boolean;
  /** They've finished or skipped the tour before: no pressure, just reading. */
  alreadyDone: boolean;
  /** Where to go afterwards: the fair-play page for new people, otherwise where they were headed. */
  next: string;
}) {
  const router = useRouter();
  const last = STEPS.length; // the final "ready?" screen is one past the steps
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(last, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const leave = (understood: boolean) => {
    setError(null);
    if (!loggedIn) {
      router.push(understood ? "/api/auth/login?returnTo=%2F" : "/");
      return;
    }
    start(async () => {
      const r = await safely(finishTourAction(understood));
      if (!r.ok) return setError(r.error);
      router.push(next);
      router.refresh();
    });
  };

  const step = i < last ? STEPS[i]! : null;
  const total = STEPS.length + 1;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted" aria-live="polite">
          Step {i + 1} of {total}
        </p>
        {!pending && (
          <button type="button" onClick={() => leave(false)} className="text-sm font-semibold text-muted hover:text-ink hover:underline">
            {alreadyDone ? "Close" : "Skip the tour"}
          </button>
        )}
      </div>
      <div className="mb-6 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={i + 1} aria-label="Tour progress">
        {Array.from({ length: total }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => setI(n)}
            aria-label={`Go to step ${n + 1}`}
            className={`h-1.5 flex-1 rounded-full transition-colors ${n <= i ? "bg-ink" : "bg-surface-3 hover:bg-faint"}`}
          />
        ))}
      </div>

      {step ? (
        <section className="grid items-center gap-6 rounded-2xl bg-surface p-5 shadow-mid sm:p-6 md:grid-cols-2" aria-label={step.title}>
          <div className="space-y-3 text-[15px] leading-6">
            <h1 className="text-2xl font-bold tracking-tight">{step.title}</h1>
            <div className="space-y-3 text-muted [&_strong]:text-ink">{step.body}</div>
          </div>
          <div className="min-w-0">{step.visual}</div>
        </section>
      ) : (
        <section className="rounded-2xl bg-surface p-5 shadow-mid sm:p-6" aria-label="Ready to start">
          <h1 className="text-2xl font-bold tracking-tight">Ready to start?</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">
            That&apos;s the whole game: prices are chances, shares pay 1 Lc if you&apos;re right, and you can sell any time. One more thing: play fair.
            Insider trading is strictly prohibited, and accounts that break the rules can be banned.
          </p>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            {[
              ["Price = chance", "Yes at 65c is a 65% chance."],
              ["Right pays 1 Lc", "Wrong pays nothing."],
              ["Sell any time", "No need to wait for the end."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl bg-surface-2 p-3">
                <div className="font-semibold">{t}</div>
                <div className="text-muted">{d}</div>
              </li>
            ))}
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2 p-3.5 text-sm">
            <input
              type="checkbox"
              checked={ready}
              onChange={(e) => setReady(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span>
              I fully understand how the markets work and I&apos;m ready to use them.
            </span>
          </label>
          {error && <p className="mt-3 text-sm text-no">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() => leave(true)}
              className="h-10 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {pending ? "Saving..." : loggedIn ? "I'm ready" : "Log in to start"}
            </button>
            <Link href="/" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
              Just browse for now
            </Link>
          </div>
        </section>
      )}

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setI((x) => Math.max(0, x - 1))}
          disabled={i === 0}
          className="h-10 rounded-[10px] border border-line px-4 text-sm font-semibold hover:bg-hover disabled:opacity-30"
        >
          Back
        </button>
        {i < last && (
          <button
            type="button"
            onClick={() => setI((x) => Math.min(last, x + 1))}
            className="h-10 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
