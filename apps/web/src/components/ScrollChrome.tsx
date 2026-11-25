"use client";

import { useEffect } from "react";

/** Marks the document once the page has scrolled, so the header and trade ticket can settle. */
export function ScrollChrome() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      frame = 0;
      root.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove("is-scrolled");
    };
  }, []);
  return null;
}
