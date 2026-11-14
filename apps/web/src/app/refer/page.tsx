import Link from "next/link";
import { referralSummary } from "@cheddar/exchange";
import { ShareButton } from "@/components/ShareButton";
import { getDb } from "@/lib/db";
import { formatDate, formatLatta } from "@/lib/format";
import { inviteUrl, referralConfig as cfg } from "@/lib/referral";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invite friends · Cheddar" };

const STATUS: Record<string, string> = { pending: "Hasn't traded yet", paid: "Rewarded", void: "No reward" };

export default async function ReferPage() {
  const user = await requireUser("/refer");
  const s = await referralSummary(await getDb(), user.id, cfg);
  const link = inviteUrl(s.code);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Invite friends</h1>
      <p className="mt-1.5 text-sm text-muted">
        When someone new joins through your link and makes their first trade, you get <strong>{formatLatta(cfg.referrerTicks)} Lc</strong> and they
        get <strong>{formatLatta(cfg.refereeTicks)} Lc</strong>.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-surface p-3 shadow-mid">
        <input
          readOnly
          value={link}
          aria-label="Your invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none"
        />
        <ShareButton url={link} title="Join me on Cheddar" text="Trade on what happens next in Hack Club with Latta Cheese." label="Copy / share" />
      </div>

      <section className="mt-6 grid grid-cols-3 gap-3" aria-label="Your invites">
        <Stat label="Rewarded" value={`${s.rewarded}/${s.cap}`} />
        <Stat label="Waiting" value={String(s.pending)} />
        <Stat label="Earned" value={`${formatLatta(s.earnedTicks)} Lc`} />
      </section>

      {s.invitedBy && (
        <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">
          You joined through <strong>{s.invitedBy.name ?? "a Hack Clubber"}</strong>
          {s.invitedBy.status === "paid"
            ? `, and got a ${formatLatta(s.invitedBy.bonusTicks)} Lc welcome bonus on your first trade.`
            : `. You'll get a ${formatLatta(cfg.refereeTicks)} Lc welcome bonus when you make your first trade.`}
        </p>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">The rules</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>
            The reward pays when the person you invited makes their first real trade (at least {formatLatta(cfg.minVolumeTicks)} Lc traded). They
            need Latta to do that, so they have to link Hackatime and code first.
          </li>
          <li>
            It only counts for brand-new accounts that signed up through your link. You can earn on up to {cfg.cap} invited people; after that
            they still get their welcome bonus, but you don&apos;t earn more.
          </li>
          <li>
            One account per person. Alts, inviting yourself and trading back and forth to farm rewards break the{" "}
            <Link href="/welcome" className="underline">
              fair play rules
            </Link>
            , and Cheesemongers can remove rewards and suspend accounts.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">People you invited</h2>
        {!s.people.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            Nobody yet. Share your link, or use the Share button on any wheel to invite someone to it.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl bg-surface shadow-mid">
            {s.people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/u/${p.id}`} className="min-w-0 truncate font-medium hover:underline">
                  {p.name ?? "Hack Clubber"}
                </Link>
                <span className="tabular shrink-0 text-xs text-muted">
                  {p.status === "paid" && p.earnedTicks > 0 ? `+${formatLatta(p.earnedTicks)} Lc` : STATUS[p.status] ?? p.status} · {formatDate(p.joinedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-mid">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}
