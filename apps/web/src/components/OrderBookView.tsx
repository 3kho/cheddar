import { formatLatta, formatShares } from "@/lib/format";
import { levelsFor, type Depth } from "@/lib/market";

/** Polymarket-style ladder in the chosen outcome's terms: asks above, bids below. */
export function OrderBookView({ depth, outcome }: { depth: Depth; outcome: "YES" | "NO" }) {
  const asks = levelsFor(depth, outcome, "BUY").slice(0, 8);
  const bids = levelsFor(depth, outcome, "SELL").slice(0, 8);
  const maxQty = Math.max(1, ...asks.map((l) => l[1]), ...bids.map((l) => l[1]));
  const spread = asks[0] && bids[0] ? asks[0][0] - bids[0][0] : null;

  const Row = ({ price, qty, side }: { price: number; qty: number; side: "ask" | "bid" }) => (
    <div className="relative grid grid-cols-3 px-3 py-1 text-sm tabular">
      <div
        className={`absolute inset-y-0 left-0 ${side === "ask" ? "bg-no-soft" : "bg-yes-soft"}`}
        style={{ width: `${(qty / maxQty) * 100}%` }}
      />
      <span className={`relative font-semibold ${side === "ask" ? "text-no" : "text-yes"}`}>{price}¢</span>
      <span className="relative text-right">{formatShares(qty)}</span>
      <span className="relative text-right text-muted">{formatLatta(price * qty)}</span>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-3 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Price</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Total</span>
      </div>
      {asks.length === 0 && <p className="px-3 py-2 text-xs text-muted">No asks</p>}
      {[...asks].reverse().map(([p, q]) => (
        <Row key={`a${p}`} price={p} qty={q} side="ask" />
      ))}
      <div className="flex justify-between border-y border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
        <span>Spread</span>
        <span className="tabular">{spread == null ? "—" : `${spread}¢`}</span>
      </div>
      {bids.map(([p, q]) => (
        <Row key={`b${p}`} price={p} qty={q} side="bid" />
      ))}
      {bids.length === 0 && <p className="px-3 py-2 text-xs text-muted">No bids</p>}
    </div>
  );
}
