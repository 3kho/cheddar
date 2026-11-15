"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCategoryAction, type ActionResult } from "@/lib/actions";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";

export function CategoryForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await safely(addCategoryAction(name));
      setResult(r);
      if (r.ok) {
        setName("");
        router.refresh();
      }
    });
  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !pending) submit();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New category, e.g. Sports"
          className="h-9 flex-1 rounded-md border border-line bg-surface-2 px-3 text-sm outline-none focus:border-primary"
        />
        <button
          disabled={!name.trim() || pending}
          className="rounded-[10px] bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          Add category
        </button>
      </form>
      {result && <Notice result={result} />}
    </div>
  );
}
