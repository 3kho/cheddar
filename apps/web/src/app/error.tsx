"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { CheeseIcon } from "@/components/Icons";

const KEY = "cheddar:auto-retry";

/**
 * A page failed to render, usually a transient database or network hiccup on a serverless host.
 * Retry once on its own (at most every 15s, so a real bug can't loop), then offer a button.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  useEffect(() => {
    console.error(error);
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0);
    } catch {}
    if (Date.now() - last < 15_000) {
      setRetrying(false);
      return;
    }
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {}
    setRetrying(true);
    const t = setTimeout(retry, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <CheeseIcon size={52} strokeWidth={1.4} className="mx-auto text-accent" />
      <h1 className="mt-4 text-xl font-bold">{retrying ? "Reloading…" : "This page didn't load"}</h1>
      <p className="mt-2 text-sm text-muted">
        {retrying ? "That took a hiccup. Trying again." : "Something went wrong loading this page. Your Latta and orders are safe."}
      </p>
      {!retrying && (
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={retry}
            className="rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Try again
          </button>
          <button onClick={() => window.location.reload()} className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold hover:bg-hover">
            Reload
          </button>
        </div>
      )}
      {error.digest && <p className="mt-4 text-[11px] text-faint">Error {error.digest}</p>}
    </div>
  );
}
