import Link from "next/link";
import { notFound } from "next/navigation";
import { listMarketIcons } from "@/lib/market-icons";
import { ProposeForm } from "@/components/ProposeForm";
import { allCategories, getWheel } from "@/lib/queries";
import { requireCheesemonger } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit wheel · Cheddar" };

export default async function EditWheelPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireCheesemonger();
  const data = await getWheel((await params).slug);
  if (!data) notFound();
  const { wheel } = data;
  const settled = wheel.status === "resolved" || wheel.status === "moldy";
  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <Link href={`/wheel/${wheel.slug}`} className="text-sm font-medium text-muted hover:text-ink">
          ← Back to the wheel
        </Link>
        <h1 className="mt-2 text-[32px] font-semibold leading-9 tracking-[-0.01em]">Edit wheel</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Everything here is live. Outcomes people may hold can be renamed but not removed; new ones are added when you save.
        </p>
      </header>
      {settled ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          This wheel has already ripened, so it can&apos;t be edited.
        </p>
      ) : (
        <ProposeForm
          categories={await allCategories()}
          icons={listMarketIcons()}
          mode={{ kind: "wheel", id: wheel.id, slug: wheel.slug, wedges: wheel.wedges.map((w) => ({ id: w.id, label: w.label })) }}
          initial={{
            title: wheel.title,
            description: wheel.description,
            category: wheel.category,
            resolutionCriteria: wheel.resolutionCriteria,
            outcomes: [],
            icon: wheel.icon,
            closesAt: wheel.closesAt?.toISOString() ?? null,
            allowAdditions: wheel.allowAdditions,
          }}
        />
      )}
    </div>
  );
}
