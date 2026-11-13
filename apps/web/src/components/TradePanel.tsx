"use client";

import { safely } from "@/lib/safely";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { placeOrderAction, type ActionResult } from "@/lib/actions";
import { formatLatta, formatShares, parseLatta } from "@/lib/format";
import {
  DEFAULT_SLIPPAGE,
  bestPrice,
  capLevels,
  levelsFor,
  payoutRange,
  quoteBuy,
  quoteSell,
  withBuy,
  type Depth,
  type Holding,
} from "@/lib/market";
import { Notice } from "./ActionButton";
import { AlertIcon, CoinsIcon } from "./Icons";
import { WheelIcon } from "./Logo";

export interface TradeWedge {
  id: string;
  label: string;
  depth: Depth;
  /** Shares this viewer can sell right now (not reserved by open sells). */
  freeYes: number;
  freeNo: number;
  /** All shares held, including ones reserved by open sells. */
  heldYes: number;
  heldNo: number;
  /** What the held shares cost, in ticks, at the viewer's average buy price. */
  costYes: number;
  costNo: number;
}

const SLIPPAGES = [2, 5, 10, 25] as const;
const QUICK_ADD = [1, 5, 10, 100] as const;

export function TradePanel({
  wedges,
  wedgeId,
  outcome: initialOutcome,
  availableTicks,
  gate,
  binary,
  title,
  category,
  icon,
}: {
  wedges: TradeWedge[];
  wedgeId: string;
  outcome: "YES" | "NO";
  availableTicks: number;
  /** Why this viewer can't trade (and where to go), or null. */
  gate: { reason: string; href?: string; cta?: string; icon?: React.ReactNode } | null;
  binary: boolean;
  title: string;
  category: string | null;
  icon: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [outcome, setOutcome] = useState(initialOutcome);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => setOutcome(initialOutcome), [initialOutcome, wedgeId]);
  useEffect(() => {
    setResult(null);
    setPrice("");
  }, [wedgeId, outcome, side]);

  const wedge = wedges.find((w) => w.id === wedgeId) ?? wedges[0]!;
  const allLevels = levelsFor(wedge.depth, outcome, side);
  const { levels, cap } = capLevels(allLevels, side, slippage);
  const best = allLevels[0]?.[0] ?? null;
  const yesPx = bestPrice(wedge.depth, "YES", side);
  const noPx = bestPrice(wedge.depth, "NO", side);
  const free = outcome === "YES" ? wedge.freeYes : wedge.freeNo;
  const limitPrice = price === "" ? (bestPrice(wedge.depth, outcome, side) ?? 50) : price;
  const shareCount = Number.parseInt(shares, 10) || 0;
  const outcomeName = (o: "YES" | "NO") => (o === "YES" ? "Yes" : "No");

  let rows: { label: string; value: string }[] = [];
  /** The big number at the bottom: "To win" for buys, "You'll receive" for sells. */
  let headline: { label: string; value: string; sub?: string } | null = null;
  let canSubmit = false;
  /** Small print above the button (price impact, partial fills). */
  const notes: string[] = [];
  /** Shares and cost (ticks) this order would buy, for the payout check below. */
  let buyShares = 0;
  let buyCost = 0;

  if (mode === "market" && side === "BUY") {
    const budget = parseLatta(amount) ?? 0;
    const q = quoteBuy(levels, budget);
    canSubmit = q.shares > 0;
    buyShares = q.shares;
    buyCost = q.cost;
    const avg = q.shares ? q.cost / q.shares : null;
    if (q.shares) {
      headline = {
        label: "To win",
        value: formatLatta(q.shares * 100),
        sub: `${formatShares(q.shares)} shares · avg. ${avg!.toFixed(1)}¢`,
      };
    }
    if (budget > 0 && cap != null && budget - q.cost >= (levels.at(-1)?.[0] ?? 100)) {
      notes.push(`Only ${formatLatta(q.cost)} can fill at ${cap}¢ or better. The rest stays in your cash.`);
    }
    if (avg != null && best != null && avg - best >= 3) notes.push(`Price impact: you'd pay ${(avg - best).toFixed(1)}¢ more than the best price.`);
  } else if (mode === "market") {
    const want = Math.min(shareCount, free);
    const q = quoteSell(levels, want);
    canSubmit = q.shares > 0;
    if (q.shares) {
      headline = {
        label: "You'll receive",
        value: formatLatta(q.proceeds),
        sub: `${formatShares(q.shares)} shares · avg. ${(q.proceeds / q.shares).toFixed(1)}¢`,
      };
    }
    if (want > q.shares && cap != null) notes.push(`Only ${formatShares(q.shares)} shares can sell at ${cap}¢ or better.`);
  } else {
    const total = limitPrice * shareCount;
    canSubmit = shareCount > 0 && limitPrice >= 1 && limitPrice <= 99;
    if (side === "BUY") {
      buyShares = shareCount;
      buyCost = total;
      rows = [{ label: "Total", value: formatLatta(total) }];
      if (shareCount) headline = { label: "To win", value: formatLatta(shareCount * 100) };
    } else if (shareCount) {
      headline = { label: "You'll receive", value: formatLatta(total) };
    }
  }

  // Warnings that matter more than price impact: overpaying, and positions that can only lose.
  const warnings: string[] = [];
  if (buyShares > 0) {
    const avg = buyCost / buyShares;
    if (avg >= 90) {
      warnings.push(
        `You'd pay ${avg.toFixed(0)}¢ a share to win ${(100 - avg).toFixed(0)}¢ if you're right, and lose ${avg.toFixed(0)}¢ if you're wrong.`,
      );
    }
    const holdings: Holding[] = wedges.map((w) => ({ wedgeId: w.id, yes: w.heldYes, no: w.heldNo, cost: w.costYes + w.costNo }));
    const after = withBuy(holdings, wedge.id, outcome, buyShares, buyCost);
    const paid = after.reduce((s, h) => s + h.cost, 0);
    const { max } = payoutRange(after, binary);
    if (max < paid) {
      warnings.push(
        `This locks in a loss. However this wheel settles, your shares here pay at most ${formatLatta(max)}, but you'll have paid ${formatLatta(paid)}.`,
      );
    }
  }

  const pickOutcome = (o: "YES" | "NO") => {
    setOutcome(o);
    router.replace(`${pathname}?w=${wedge.id}&o=${o}`, { scroll: false });
  };

  const submit = () =>
    start(async () => {
      const r = await safely(placeOrderAction({
        wedgeId: wedge.id,
        outcome,
        side,
        mode,
        price: mode === "limit" ? limitPrice : undefined,
        shares: mode === "limit" || side === "SELL" ? shareCount : undefined,
        amount: mode === "market" && side === "BUY" ? amount : undefined,
        slippage: mode === "market" ? slippage : undefined,
      }));
      setResult(r);
      if (r.ok) {
        setAmount("");
        setShares("");
        router.refresh();
      }
    });

  const bigInput =
    "h-[50px] w-full min-w-0 bg-transparent text-right text-[32px] font-semibold tabular tracking-tight outline-none placeholder:text-faint";
  const opposite = outcome === "YES" ? "NO" : "YES";
  const heldOpposite = outcome === "YES" ? wedge.heldNo : wedge.heldYes;

  return (
    <div>
      <div className="flex flex-col gap-5 rounded-xl bg-surface p-4 shadow-mid">
        {/* What you're trading */}
        <div className="flex items-center gap-3">
          <WheelIcon icon={icon} category={category} size={48} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-muted">{binary ? category ?? "Cheddar" : title}</div>
            <div className="truncate text-base font-semibold">
              {binary ? title : wedge.label}
              <span className={outcome === "YES" ? "text-yes" : "text-no"}> · {outcomeName(outcome)}</span>
            </div>
          </div>
        </div>

        {/* Buy / Sell, and order type */}
        <div className="-mx-4 flex items-center justify-between border-b border-line px-4 pb-2">
          <div className="flex gap-3">
            {(["BUY", "SELL"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                aria-pressed={side === s}
                className={`relative text-base font-semibold transition-colors ${side === s ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {s === "BUY" ? "Buy" : "Sell"}
                {side === s && <span className="absolute inset-x-0 -bottom-[9px] h-0.5 rounded-full bg-ink" />}
              </button>
            ))}
          </div>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "market" | "limit")}
            className="cursor-pointer rounded-md bg-transparent py-0.5 text-sm font-medium text-muted outline-none hover:text-ink"
            aria-label="Order type"
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </div>

        {/* Yes / No */}
        <div className="flex gap-3 pb-1">
          {(["YES", "NO"] as const).map((o) => {
            const active = outcome === o;
            const px = o === "YES" ? yesPx : noPx;
            const tone = active
              ? o === "YES"
                ? "bg-yes-solid text-white"
                : "bg-no-solid text-white"
              : "bg-surface-2 text-ink ring-1 ring-inset ring-line hover:bg-surface-3";
            return (
              <button
                key={o}
                onClick={() => pickOutcome(o)}
                aria-pressed={active}
                className={`btn-3d flex h-12 flex-1 items-center justify-center gap-1.5 ${tone}`}
              >
                <span className={`text-[15px] font-semibold ${active ? "opacity-80" : "opacity-60"}`}>{outcomeName(o)}</span>
                <span className="tabular text-base font-semibold">{px == null ? "—" : `${px}¢`}</span>
              </button>
            );
          })}
        </div>

        {mode === "limit" && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-base font-medium">Limit price</span>
            <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
              <button onClick={() => setPrice(Math.max(1, limitPrice - 1))} className="h-9 w-9 rounded-md text-lg font-semibold hover:bg-hover" aria-label="Lower price">
                −
              </button>
              <div className="relative w-16">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={limitPrice}
                  onChange={(e) => setPrice(e.target.value === "" ? "" : Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)))))}
                  className="h-9 w-full bg-transparent pr-4 text-center text-base font-semibold tabular outline-none"
                  aria-label="Limit price in cents"
                />
                <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-sm text-muted">¢</span>
              </div>
              <button onClick={() => setPrice(Math.min(99, limitPrice + 1))} className="h-9 w-9 rounded-md text-lg font-semibold hover:bg-hover" aria-label="Raise price">
                +
              </button>
            </div>
          </div>
        )}

        {/* Amount or shares */}
        {mode === "market" && side === "BUY" ? (
          <div>
            <label className="flex items-center justify-between gap-3">
              <span className="shrink-0">
                <span className="block text-base font-medium">Amount</span>
                <span className="tabular block text-xs text-muted">Cash {formatLatta(availableTicks)}</span>
              </span>
              <input inputMode="decimal" placeholder="ʟ0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/^ʟ/, ""))} className={bigInput} />
            </label>
            <div className="mt-2 flex justify-end gap-1">
              {QUICK_ADD.map((n) => (
                <Chip key={n} onClick={() => setAmount(String(((parseLatta(amount) ?? 0) + n * 100) / 100))}>
                  +ʟ{n}
                </Chip>
              ))}
              <Chip onClick={() => setAmount(String(availableTicks / 100))}>Max</Chip>
            </div>
          </div>
        ) : (
          <div>
            <label className="flex items-center justify-between gap-3">
              <span className="shrink-0">
                <span className="block text-base font-medium">Shares</span>
                <span className="tabular block text-xs text-muted">
                  {side === "SELL" ? `You have ${formatShares(free)}` : `Cash ${formatLatta(availableTicks)}`}
                </span>
              </span>
              <input inputMode="numeric" placeholder="0" value={shares} onChange={(e) => setShares(e.target.value.replace(/\D/g, ""))} className={bigInput} />
            </label>
            {side === "SELL" && free > 0 && (
              <div className="mt-2 flex justify-end gap-1">
                {[25, 50].map((p) => (
                  <Chip key={p} onClick={() => setShares(String(Math.floor((free * p) / 100)))}>
                    {p}%
                  </Chip>
                ))}
                <Chip onClick={() => setShares(String(free))}>Max</Chip>
              </div>
            )}
          </div>
        )}

        {(rows.length > 0 || headline) && (
          <dl className="space-y-1.5">
            {rows.map((s) => (
              <div key={s.label} className="flex justify-between text-sm">
                <dt className="text-muted">{s.label}</dt>
                <dd className="tabular font-semibold">{s.value}</dd>
              </div>
            ))}
            {headline && (
              <div className="flex items-end justify-between gap-3">
                <dt>
                  <span className="flex items-center gap-1.5 text-base font-medium">
                    {headline.label}
                    {headline.label === "To win" && <CoinsIcon size={16} className="text-yes" />}
                  </span>
                  {headline.sub && <span className="tabular block text-xs text-muted">{headline.sub}</span>}
                </dt>
                <dd className={`tabular text-[28px] font-semibold leading-8 ${headline.label === "To win" ? "text-yes" : ""}`}>{headline.value}</dd>
              </div>
            )}
          </dl>
        )}

        {(mode === "market" || warnings.length > 0 || notes.length > 0 || (side === "BUY" && heldOpposite > 0)) && (
          <div className="-mt-1 space-y-2.5">
            {mode === "market" && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted" title="A market order never fills further than this from the best price.">
                  Max slippage{cap != null && <span className="tabular"> · {side === "BUY" ? "≤" : "≥"} {cap}¢</span>}
                </span>
                <div className="flex gap-1">
                  {SLIPPAGES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSlippage(v)}
                      aria-pressed={slippage === v}
                      className={`tabular rounded-md px-1.5 py-0.5 font-semibold transition-colors ${
                        slippage === v ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"
                      }`}
                    >
                      {v}¢
                    </button>
                  ))}
                </div>
              </div>
            )}

            {side === "BUY" && heldOpposite > 0 && (
              <p className="rounded-lg bg-accent-soft p-2.5 text-xs leading-relaxed">
                You already hold <strong>{formatShares(heldOpposite)} {outcomeName(opposite)}</strong> here. Buying {outcomeName(outcome)} too
                makes pairs that always pay exactly ʟ1, so you mostly just pay the spread.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => {
                    setSide("SELL");
                    pickOutcome(opposite);
                  }}
                >
                  Sell your {outcomeName(opposite)} instead
                </button>
              </p>
            )}

            {warnings.map((n) => (
              <p key={n} role="alert" className="flex gap-2 rounded-lg border border-no/40 bg-no-soft p-2.5 text-xs font-medium leading-relaxed text-ink">
                <AlertIcon size={15} className="mt-px shrink-0 text-no" />
                <span>{n}</span>
              </p>
            ))}

            {notes.map((n) => (
              <p key={n} className="text-xs font-medium text-warn">
                {n}
              </p>
            ))}
          </div>
        )}

        {gate ? (
          <div>
            {gate.href ? (
              <a href={gate.href} className="btn-3d flex h-12 w-full items-center justify-center gap-2 bg-primary text-base font-bold text-white">
                {gate.icon}
                {gate.cta ?? "Continue"}
              </a>
            ) : (
              <button disabled className="btn-3d flex h-12 w-full items-center justify-center gap-2 bg-surface-2 text-base font-bold text-muted opacity-70">
                {gate.icon}
                {gate.cta ?? "Trading unavailable"}
              </button>
            )}
            <p className="mt-2.5 text-center text-xs text-muted">{gate.reason}</p>
          </div>
        ) : (
          <button
            onClick={submit}
            disabled={!canSubmit || pending}
            className="btn-3d flex h-12 w-full items-center justify-center bg-primary text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Placing…" : `${side === "BUY" ? "Buy" : "Sell"} ${outcomeName(outcome)}`}
          </button>
        )}
        {result && (
          <div className="-mt-2 text-center">
            <Notice result={result} />
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-[13px] text-faint">Each share pays ʟ1 if it&apos;s right and ʟ0 if it&apos;s wrong.</p>
    </div>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[30px] rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}
