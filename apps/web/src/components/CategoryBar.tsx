"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckIcon, FlameIcon, SparkIcon } from "./Icons";

/** Second nav row: sort views, a divider, then categories. Plain text tabs, active one darker. */
export function CategoryBar({ categories }: { categories: string[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const onHome = pathname === "/";
  const sort = sp.get("sort") ?? "trending";
  const cat = sp.get("c");

  const item = (href: string, active: boolean, children: React.ReactNode) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap px-2 text-sm font-semibold transition-colors first:pl-0 ${
        active ? "text-ink" : "text-muted hover:text-faint"
      }`}
    >
      {children}
    </Link>
  );

  return (
    <div className="relative mx-auto max-w-[1350px]">
      <div className="no-scrollbar flex h-12 snap-x items-center overflow-x-auto px-4 lg:px-6">
        {item("/", onHome && !cat && sort === "trending", <><FlameIcon size={16} /> Trending</>)}
        {item("/?sort=new", onHome && !cat && sort === "new", <><SparkIcon size={16} /> New</>)}
        {item("/?sort=resolved", onHome && !cat && sort === "resolved", <><CheckIcon size={16} /> Resolved</>)}
        {categories.length > 0 && <span className="mx-2 h-3.5 w-0.5 shrink-0 rounded-full bg-surface-3" aria-hidden="true" />}
        {categories.map((c) => item(`/?c=${encodeURIComponent(c)}`, onHome && cat === c, c))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg sm:hidden" aria-hidden="true" />
    </div>
  );
}
