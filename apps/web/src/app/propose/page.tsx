import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { WheelIcon } from "@/components/Logo";
import { ProposeForm } from "@/components/ProposeForm";
import { withdrawProposalAction } from "@/lib/actions";
import { formatDate } from "@/lib/format";
import { allCategories, myProposals } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Propose a wheel · Cheddar" };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "In review", cls: "bg-accent-soft text-ink" },
  approved: { label: "Live", cls: "bg-yes-soft text-yes" },
  rejected: { label: "Not approved", cls: "bg-no-soft text-no" },
  withdrawn: { label: "Withdrawn", cls: "bg-surface-2 text-muted" },
};

export default async function ProposePage() {
  const user = await requireUser("/propose");
  const [mine, categories] = await Promise.all([myProposals(user.id), allCategories()]);
  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <h1 className="text-[32px] font-semibold leading-9 tracking-[-0.01em]">Propose a wheel</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Ask a question about what happens next in Hack Club. A Cheesemonger checks it&apos;s clear and fair, then it goes
          live for everyone to trade.
        </p>
      </header>
      <ProposeForm categories={categories}>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Your proposals</h2>
          {mine.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {mine.map(({ p, wheelSlug }) => {
                const st = STATUS[p.status] ?? STATUS.pending!;
                return (
                  <li key={p.id} className="rounded-xl bg-surface p-3 text-sm shadow-soft">
                    <div className="flex items-start gap-2.5">
                      <WheelIcon icon={p.icon} category={p.category} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 font-medium leading-5">{p.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${st.cls}`}>{st.label}</span>
                          <span>{formatDate(p.createdAt)}</span>
                          {p.status === "approved" && wheelSlug && (
                            <Link href={`/wheel/${wheelSlug}`} className="font-semibold text-primary hover:underline">
                              Open →
                            </Link>
                          )}
                          {p.status === "pending" && (
                            <ActionButton action={withdrawProposalAction.bind(null, p.id)} className="font-semibold hover:text-ink hover:underline">
                              Withdraw
                            </ActionButton>
                          )}
                        </div>
                        {p.reviewNote && <p className="mt-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">“{p.reviewNote}”</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </ProposeForm>
    </div>
  );
}
