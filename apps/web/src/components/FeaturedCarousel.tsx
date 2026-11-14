"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";

const INTERVAL_MS = 9_000;

/**
 * A row of featured cards that slides to the next one every few seconds. It stops while the
 * pointer or keyboard focus is inside it, when the tab is hidden, and for people who prefer
 * reduced motion (they can still use the arrows and dots).
 */
export function FeaturedCarousel({ children }: { children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    const vis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      mq.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  // Restarting on every change of `index` keeps the full time on a slide after a manual move.
  useEffect(() => {
    if (count < 2 || paused || reduced || hidden) return;
    const t = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [index, count, paused, reduced, hidden, go]);

  // Swipe on touch screens.
  const touchX = useRef<number | null>(null);

  if (count === 0) return null;
  if (count === 1) return <>{slides[0]}</>;
  return (
    <div
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured markets"
      className="min-w-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(index - 1);
        if (e.key === "ArrowRight") go(index + 1);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || Math.abs(end - start) < 50) return;
        go(index + (end < start ? 1 : -1));
      }}
    >
      <div className="overflow-hidden rounded-[18px]">
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
          aria-live={paused || reduced ? "polite" : "off"}
        >
          {slides.map((s, i) => (
            <div
              key={i}
              className="flex w-full shrink-0 flex-col"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
              // Off-screen cards shouldn't be tabbable.
              {...(i !== index ? { inert: true } : {})}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous market"
          className="grid size-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show market ${i + 1}`}
              aria-current={i === index}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-ink" : "w-2 bg-surface-3 hover:bg-faint"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next market"
          className="grid size-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
        >
          ›
        </button>
      </div>
    </div>
  );
}
