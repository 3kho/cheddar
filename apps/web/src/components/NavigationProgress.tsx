"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import "./nprogress.css";

NProgress.configure({ showSpinner: false, trickleSpeed: 120, minimum: 0.08, speed: 280 });

function samePlace(url: URL) {
  return url.pathname === window.location.pathname && url.search === window.location.search;
}

/** Top bar for client navigations. Completes when the App Router commits the next URL. */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    NProgress.done();
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || samePlace(url)) return;
      NProgress.start();
    };

    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || form.target || e.defaultPrevented) return;
      const method = (form.getAttribute("method") || "get").toLowerCase();
      if (method !== "get") return;
      NProgress.start();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
