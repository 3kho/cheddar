"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateProfileAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";

export function ProfileForm({ initialName, maxLength }: { initialName: string; maxLength: number }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const unchanged = name.trim() === initialName.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await safely(updateProfileAction(name));
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <label htmlFor="display-name" className="mb-1.5 block text-sm font-semibold">
        Display name
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={maxLength}
          autoComplete="off"
          className="h-10 flex-1 rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none focus:border-primary"
        />
        <button
          disabled={!name.trim() || unchanged || pending}
          className="h-10 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Shown on the leaderboard, activity feed and your trades. Up to {maxLength} characters. It's yours to pick: it doesn't have to match your real name.
      </p>
      {result && <Notice result={result} />}
    </form>
  );
}
