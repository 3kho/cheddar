import Link from "next/link";
import { formatChance, formatLatta, timeUntil } from "@/lib/format";
import type { WedgeView, WheelView } from "@/lib/queries";
import { Change, CheeseIcon, ClockIcon, MoldIcon, PauseIcon, TickIcon } from "./Icons";
import { WheelIcon } from "./Logo";

/** Half-ring gauge for a binary wheel's chance, coloured by which side is favoured. */
export function Gauge({ chance, size = 58 }: { chance: number | null; size?: number }) {
  const r = 26;
  const c = Math.PI * r; // half circle
  const p = chance ?? 0;
  const color = chance == null ? "var(--muted)" : p >= 50 ? "var(--yes)" : "var(--no)";
  return (
    <div className="relative flex shrink-0 flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size * 0.6} viewBox="0 0 64 38" aria-hidden="true">
        <path d="M6 34 A26 26 0 0 1 58 34" fill="none" stroke="var(--surface-3)" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M6 34 A26 26 0 0 1 58 34"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
        />
      </svg>
      <div className="-mt-[19px] text-center leading-none">
        <div className="tabular text-base font-medium">{formatChance(chance)}</div>
        <div className="mt-0.5 text-[11px] font-semibold text-muted">chance</div>
      </div>
    </div>
  );
}

type StatusWheel = Pick<WheelView, "status" | "tradingPausedAt" | "closesAt">;

/** Short status text ("Ripening", "Paused", "3d left"), or "" for a plain open wheel. */
export function wheelStatusLabel(wheel: StatusWheel): string {
  if (wheel.status === "ripening") return "Ripening";
  if (wheel.status === "resolved") return "Resolved";
  if (wheel.status === "moldy") return "Moldy";
  if (wheel.tradingPausedAt) return "Paused";
  if (wheel.status === "closed") return "Closed";
  return wheel.closesAt ? timeUntil(wheel.closesAt) : "";
}

/** The status label with its icon. Renders nothing for a plain open wheel. */
export function WheelStatus({ wheel, className = "" }: { wheel: StatusWheel; className?: string }) {
  const label = wheelStatusLabel(wheel);
  if (!label) return null;
  const Icon =
    wheel.status === "ripening"
      ? CheeseIcon
      : wheel.status === "moldy"
        ? MoldIcon
        : wheel.status === "resolved"
          ? TickIcon
          : wheel.tradingPausedAt
            ? PauseIcon
            : ClockIcon;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Icon size={12} strokeWidth={2.2} />
      {label}
    </span>
  );
}

/** What a settled wheel came out as, e.g. "Zach won", "Resolved Yes", "Moldy (void)". */
export function resolvedLabel(wheel: WheelView): string | null {
  if (wheel.status === "moldy") return "Moldy (void)";
  if (wheel.status !== "resolved") return null;
  const binary = wheel.wedges.length === 1;
  if (binary) return wheel.wedges[0]?.status === "resolved_yes" ? "Resolved Yes" : "Resolved No";
  const winner = wheel.wedges.find((w) => w.status === "resolved_yes");
  return winner ? `${winner.label} won` : "Resolved No";
}

function Footer({ wheel, change }: { wheel: WheelView; change?: number | null }) {
  return (
    <div className="relative flex items-center justify-between gap-2 px-3 pb-2.5 pt-2 text-[13px] text-muted">
      <span className="tabular flex items-center gap-2">
        {formatLatta(wheel.volumeTicks, { compact: true })} Vol.
        <Change value={change} className="text-xs" />
      </span>
      <WheelStatus wheel={wheel} className="truncate" />
    </div>
  );
}

/** Soft Yes/No pill that turns solid on hover and swaps its label for the price. */
function Pill({ href, outcome, price, size }: { href: string; outcome: "YES" | "NO"; price: number | null; size: "sm" | "lg" }) {
  const yes = outcome === "YES";
  const tone = yes
    ? "bg-yes-soft text-yes hover:bg-yes-solid hover:text-white"
    : "bg-no-soft text-no hover:bg-no-solid hover:text-white";
  const shape = size === "sm" ? "h-[27px] w-11 rounded-[5px] text-[13px]" : "h-10 flex-1 rounded-[7px] text-sm";
  return (
    <Link href={`${href}&o=${outcome}`} className={`group/pill relative z-10 grid place-items-center font-semibold transition-colors ${tone} ${shape}`}>
      <span className={price != null ? "group-hover/pill:invisible" : ""}>{yes ? "Yes" : "No"}</span>
      {price != null && <span className="tabular invisible absolute group-hover/pill:visible">{price}¢</span>}
    </Link>
  );
}

function ResolvedBadge({ wheel }: { wheel: WheelView }) {
  const label = resolvedLabel(wheel);
  if (!label) return null;
  const yes = label === "Resolved Yes" || label.endsWith(" won");
  return (
    <div
      className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-[7px] text-sm font-semibold ${
        wheel.status === "moldy" ? "bg-surface-2 text-muted" : yes ? "bg-yes-soft text-yes" : "bg-no-soft text-no"
      }`}
    >
      {wheel.status === "moldy" ? <MoldIcon size={15} /> : <TickIcon size={14} strokeWidth={3} />}
      {label}
    </div>
  );
}

const yesPrice = (w: WedgeView) => w.bestAsk;
const noPrice = (w: WedgeView) => (w.bestBid == null ? null : 100 - w.bestBid);

function OutcomeRow({ href, w, done }: { href: string; w: WedgeView; done: boolean }) {
  return (
    <li className="flex min-h-10 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-[440]">{w.label}</span>
      <span className="tabular mr-1 text-[15px] font-semibold">{formatChance(w.chance)}</span>
      {done ? (
        <span className={`w-[92px] text-right text-[13px] font-semibold ${w.status === "resolved_yes" ? "text-yes" : "text-muted"}`}>
          {w.status === "resolved_yes" ? "Won" : w.status === "moldy" ? "Void" : "Lost"}
        </span>
      ) : (
        <span className="flex gap-1">
          <Pill href={`${href}?w=${w.id}`} outcome="YES" price={yesPrice(w)} size="sm" />
          <Pill href={`${href}?w=${w.id}`} outcome="NO" price={noPrice(w)} size="sm" />
        </span>
      )}
    </li>
  );
}

export function WheelCard({ wheel }: { wheel: WheelView }) {
  const href = `/wheel/${wheel.slug}`;
  const binary = wheel.wedges.length === 1;
  const done = wheel.status === "resolved" || wheel.status === "moldy";
  const w0 = wheel.wedges[0];
  const ranked = [...wheel.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
  const shown = ranked.slice(0, 2);

  return (
    <div className="group relative flex min-h-[180px] flex-col justify-between rounded-xl bg-surface pt-3 shadow-soft transition duration-150 hover:-translate-y-px hover:shadow-mid">
      <div className="flex h-[42px] items-start gap-2.5 px-3">
        <WheelIcon icon={wheel.icon} category={wheel.category} size={38} />
        <Link
          href={href}
          className="line-clamp-2 flex-1 text-pretty text-sm font-[590] leading-[18px] decoration-2 underline-offset-2 group-hover:underline after:absolute after:inset-0 after:z-0 after:content-['']"
        >
          {wheel.title}
        </Link>
        {binary && !done && <Gauge chance={w0?.chance ?? null} />}
      </div>

      {binary && w0 ? (
        <div className="relative flex h-[62px] items-end gap-2 px-3">
          {done ? (
            <ResolvedBadge wheel={wheel} />
          ) : (
            <>
              <Pill href={`${href}?w=${w0.id}`} outcome="YES" price={yesPrice(w0)} size="lg" />
              <Pill href={`${href}?w=${w0.id}`} outcome="NO" price={noPrice(w0)} size="lg" />
            </>
          )}
        </div>
      ) : (
        <ul className="relative mt-1 px-3">
          {shown.map((w) => (
            <OutcomeRow key={w.id} href={href} w={w} done={done} />
          ))}
          {ranked.length > shown.length && <li className="text-xs text-faint">+{ranked.length - shown.length} more</li>}
        </ul>
      )}
      <Footer wheel={wheel} change={binary && !done ? w0?.change24h : null} />
    </div>
  );
}
