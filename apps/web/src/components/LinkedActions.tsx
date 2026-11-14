"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertNoAction, mergePairsAction, mergeYesSetAction, type ActionResult } from "@/lib/actions";
import { formatLatta, formatShares } from "@/lib/format";
import { Notice } from "./ActionButton";
import { LinkIcon } from "./Icons";

export interface LinkWedge {
  id: string;
  label: string;
  /** The viewer's shares not reserved by open sells. */
  freeYes: number;
  freeNo: number;
}

/**
 * Shares that are worth a fixed amount whatever happens, and the conversions that cash them in or
 * reshape them: Yes+No pairs, a Yes on every outcome, a No on every outcome, and No on one outcome
 * into Yes on all the others. Renders nothing if the viewer has nothing to convert.
 */
export function LinkedActions({
  wheelId,
  wedges,
  binary,
  fixedOutcomes = true,
}: {
  wheelId: string;
  wedges: LinkWedge[];
  binary: boolean;
  /** False while new outcomes can still be added: only Yes + No pairs are riskless then. */
  fixedOutcomes?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const withNo = wedges.filter((w) => w.freeNo > 0);
  const [from, setFrom] = useState(withNo[0]?.id ?? "");
  const [qty, setQty] = useState("");

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await safely(fn());
      setMsg(r);
      if (r.ok) {
        setQty("");
        router.refresh();
      }
    });

  const pairs = wedges.map((w) => ({ w, k: Math.min(w.freeYes, w.freeNo) })).filter((p) => p.k > 0);
  const n = wedges.length;
  const sets = !binary && fixedOutcomes;
  const yesSet = sets ? Math.min(...wedges.map((w) => w.freeYes)) : 0;
  const noSet = sets ? Math.min(...wedges.map((w) => w.freeNo)) : 0;
  const fromWedge = wedges.find((w) => w.id === from) ?? withNo[0];
  const convertMax = fromWedge?.freeNo ?? 0;
  const k = Math.min(convertMax, Math.max(0, Math.trunc(Number(qty) || convertMax)));
  const canConvert = sets && withNo.length > 0;

  if (!pairs.length && yesSet <= 0 && noSet <= 0 && !canConvert) return null;

  const btn = "h-9 shrink-0 rounded-[10px] bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50";
  const row = "flex items-center justify-between gap-3 py-3";

  return (
    <section className="rounded-xl bg-surface p-4 shadow-mid">
      <h2 className="flex items-center gap-1.5 text-base font-semibold">
        <LinkIcon size={16} /> Linked outcomes
      </h2>
      <p className="mt-1 text-xs text-muted">
        {binary
          ? "A Yes and a No together always pay 1 Lc, so you can cash pairs in now."
          : "Exactly one outcome wins, so some bundles have a fixed value. Cash them in now instead of waiting."}
      </p>
      <div className="mt-1 divide-y divide-line text-sm">
        {pairs.map(({ w, k: pk }) => (
          <div key={w.id} className={row}>
            <span className="min-w-0">
              <span className="font-medium">
                {formatShares(pk)} Yes + No pairs{!binary && <span className="text-muted"> · {w.label}</span>}
              </span>
              <span className="block text-xs text-muted">Always worth {formatLatta(pk * 100)}</span>
            </span>
            <button disabled={pending} onClick={() => run(() => mergePairsAction(w.id, pk))} className={btn}>
              Redeem
            </button>
          </div>
        ))}
        {yesSet > 0 && (
          <div className={row}>
            <span>
              <span className="font-medium">{formatShares(yesSet)} Yes on every outcome</span>
              <span className="block text-xs text-muted">Exactly one pays: worth {formatLatta(yesSet * 100)}</span>
            </span>
            <button disabled={pending} onClick={() => run(() => mergeYesSetAction(wheelId, yesSet))} className={btn}>
              Redeem
            </button>
          </div>
        )}
        {noSet > 0 && (
          <div className={row}>
            <span>
              <span className="font-medium">{formatShares(noSet)} No on every outcome</span>
              <span className="block text-xs text-muted">
                All but one pay: worth {formatLatta(noSet * 100 * (n - 1))}
              </span>
            </span>
            <button
              disabled={pending}
              onClick={() => run(() => convertNoAction(wheelId, wedges.map((w) => w.id), noSet))}
              className={btn}
            >
              Redeem
            </button>
          </div>
        )}
        {canConvert && fromWedge && (
          <div className="py-3">
            <div className="font-medium">Convert No into Yes on the others</div>
            <p className="text-xs text-muted">
              No on one outcome is the same bet as Yes on every other one. Swap them at no cost.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={fromWedge.id}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 min-w-0 flex-1 cursor-pointer rounded-[10px] border border-line bg-surface-2 px-2 text-sm outline-none focus:border-primary"
                aria-label="No shares to convert"
              >
                {withNo.map((w) => (
                  <option key={w.id} value={w.id}>
                    No · {w.label} ({formatShares(w.freeNo)})
                  </option>
                ))}
              </select>
              <input
                inputMode="numeric"
                value={qty}
                placeholder={String(convertMax)}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
                className="h-9 w-20 rounded-[10px] border border-line bg-surface-2 px-2 text-right text-sm font-semibold tabular outline-none focus:border-primary"
                aria-label="Shares"
              />
              <button disabled={pending || k <= 0} onClick={() => run(() => convertNoAction(wheelId, [fromWedge.id], k))} className={btn}>
                Convert
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              You give {formatShares(k)} No on {fromWedge.label} and get {formatShares(k)} Yes on each of the other {n - 1}.
            </p>
          </div>
        )}
      </div>
      {msg && (
        <div className="mt-1">
          <Notice result={msg} />
        </div>
      )}
    </section>
  );
}
