import Link from "next/link";
import { CheeseIcon } from "@/components/Icons";

export default async function Oops({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <CheeseIcon size={52} strokeWidth={1.4} className="mx-auto text-accent" />
      <h1 className="mt-4 text-xl font-bold">That didn&apos;t work</h1>
      <p className="mt-2 text-sm text-muted">{(m ?? "Something went wrong.").slice(0, 300)}</p>
      <Link href="/" className="mt-6 inline-block rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
        Back to Cheddar
      </Link>
    </div>
  );
}
