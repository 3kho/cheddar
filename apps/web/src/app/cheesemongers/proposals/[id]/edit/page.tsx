import Link from "next/link";
import { notFound } from "next/navigation";
import { ProposeForm } from "@/components/ProposeForm";
import { formatDate } from "@/lib/format";
import { proposalById } from "@/lib/queries";
import { requireCheesemonger } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit proposal · Cheddar" };

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCheesemonger();
  const p = await proposalById((await params).id);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <Link href="/cheesemongers?tab=proposals" className="text-sm font-medium text-muted hover:text-ink">
          ← Proposals
        </Link>
        <h1 className="mt-2 text-[32px] font-semibold leading-9 tracking-[-0.01em]">Edit proposal</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Change anything before it goes live: the question, the type, the outcomes, the rules, the icon and how it closes.
          Sent {formatDate(p.createdAt)}.
        </p>
      </header>
      {p.status !== "pending" ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          This proposal is already {p.status}, so it can&apos;t be edited here.
        </p>
      ) : (
        <ProposeForm
          mode={{ kind: "proposal", id: p.id }}
          initial={{
            title: p.title,
            description: p.description,
            category: p.category,
            resolutionCriteria: p.resolutionCriteria,
            outcomes: p.outcomes,
            icon: p.icon,
            closesAt: p.closesAt?.toISOString() ?? null,
            allowAdditions: p.allowAdditions,
          }}
        />
      )}
    </div>
  );
}
