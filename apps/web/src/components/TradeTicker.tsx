/** One recent trade, pre-formatted on the server so the ticker needs no data of its own. */
export interface TickerTrade {
  id: number;
  who: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  qty: number;
  /** Price in cents. */
  price: number;
  /** Which outcome, for multi-outcome wheels. */
  label: string | null;
  ago: string;
}

function Row({ t, copy = false }: { t: TickerTrade; copy?: boolean }) {
  return (
    <li aria-hidden={copy || undefined} className="flex h-6 items-center gap-1.5 whitespace-nowrap text-[13px]">
      <span className="min-w-0 max-w-[40%] truncate font-semibold">{t.who}</span>
      <span className="text-muted">{t.side === "BUY" ? "bought" : "sold"}</span>
      <span className="tabular font-semibold">{t.qty}</span>
      <span className={`font-semibold ${t.outcome === "YES" ? "text-yes" : "text-no"}`}>{t.outcome === "YES" ? "Yes" : "No"}</span>
      {t.label && <span className="min-w-0 truncate text-muted">· {t.label}</span>}
      <span className="tabular text-muted">at {t.price}¢</span>
      <span className="ml-auto shrink-0 text-xs text-faint">{t.ago}</span>
    </li>
  );
}

/**
 * The latest trades on a wheel, scrolling upward by themselves. Pauses when hovered or focused and
 * stays still for people who ask for less motion. With only a couple of trades there's nothing to
 * scroll, so they just sit there.
 */
export function TradeTicker({ trades }: { trades: TickerTrade[] }) {
  if (!trades.length) {
    return <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">No trades yet. Be the first!</p>;
  }
  const scrolls = trades.length > 3;
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-1.5" aria-label="Recent trades" role="group">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Recent trades</div>
      <div className={`ticker-window relative h-[72px] overflow-hidden ${scrolls ? "ticker-fade" : ""}`}>
        <ul
          className={scrolls ? "ticker-track" : ""}
          style={scrolls ? ({ "--ticker-seconds": `${trades.length * 3}s` } as React.CSSProperties) : undefined}
        >
          {trades.map((t) => (
            <Row key={t.id} t={t} />
          ))}
          {/* A second copy makes the loop seamless. Hidden from screen readers. */}
          {scrolls && trades.map((t) => <Row key={`copy-${t.id}`} t={t} copy />)}
        </ul>
      </div>
    </div>
  );
}
