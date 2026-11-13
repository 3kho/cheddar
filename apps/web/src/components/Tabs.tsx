"use client";

import { useState } from "react";

/** Simple accessible tabs; panels are rendered on the server and passed in. */
export function Tabs({ tabs, initial }: { tabs: { key: string; label: React.ReactNode; content: React.ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  return (
    <div>
      <div role="tablist" className="no-scrollbar flex gap-5 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setActive(t.key)}
            className={`-mb-px shrink-0 border-b-2 pb-3 text-base font-semibold transition-colors ${
              active === t.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} hidden={active !== t.key} className="pt-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}
