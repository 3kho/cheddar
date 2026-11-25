import { formatLatta, formatShares } from "@/lib/format";

export interface PositionLine {
  key: string;
  /** "Yes", "No", or "Outcome · Yes". */
  label: string;
  shares: number;
  /** Cost of the shares still held, in ticks. */
  investedTicks: number;
  /** Mark-to-market value in ticks, or null when the market has no price. */
  valueTicks: number | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}

/** Shares, what they cost, what they're worth now, and the percentage gain. */
export function PositionCard({ lines }: { lines: PositionLine[] }) {
  const invested = lines.reduce((s, l) => s + l.investedTicks, 0);
  const priced = lines.every((l) => l.valueTicks != null);
  const value = priced ? lines.reduce((s, l) => s + (l.valueTicks ?? 0), 0) : null;
  const gain = value != null && invested > 0 ? ((value - invested) / invested) * 100 : null;
  const gainClass = gain == null ? "text-muted" : gain > 0 ? "text-yes" : gain < 0 ? "text-no" : "text-ink";

  return (
    <section className="rounded-xl bg-surface p-4 shadow-mid" aria-label="Your position">
      <h2 className="text-sm font-semibold">Your position</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">You don&apos;t hold shares in this market.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {lines.map((l) => (
              <li key={l.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{l.label}</span>
                <span className="tabular shrink-0 font-semibold">{formatShares(l.shares)} shares</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
            <Row label="Total invested" value={formatLatta(invested)} />
            <Row label="Market value" value={value == null ? "—" : formatLatta(value)} />
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Gain</dt>
              <dd className={`tabular font-semibold ${gainClass}`}>{gain == null ? "—" : `${gain > 0 ? "+" : ""}${gain.toFixed(1)}%`}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
