import lattaCoin from "@/assets/latta-coin.png";
/** Inline icons (stroke = currentColor), so the UI needs no icon font, package, or emoji. */
type P = { size?: number; className?: string; strokeWidth?: number };

function Svg({ size = 16, className, strokeWidth = 2, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ---------- interface ----------

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const FlameIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 1.5.5 2.5 1.5 3C10.5 8.5 11 5.5 12 3Z" />
  </Svg>
);
export const SparkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const ChartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Svg>
);
export const TrophyIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
);
export const TickIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const ActivityIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Svg>
);
export const PencilIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);
export const CalendarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const ListPlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const XIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ChevronDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 19" />
  </Svg>
);
export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);
export const SunIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Svg>
);
export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Svg>
);
export const MonitorIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
);
export const CoinsIcon = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
    <path d="M4.5 6.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
    <path d="M4.5 11.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
  </Svg>
);
export const SparklesIcon = (p: P) => (
  <Svg {...p}>
    <path d="m11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9Z" />
    <path d="m18.5 15 .8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7Z" />
  </Svg>
);
export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

// ---------- Cheddar characters ----------

/** A cheddar wedge with holes. */
export const CheeseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 18.5 13.5 6.5 21 11.5v7Z" />
    <path d="M3 18.5 21 11.5" />
    <circle cx="9.5" cy="15.5" r="1.1" />
    <circle cx="15.5" cy="15.5" r="1.4" />
    <circle cx="13" cy="10.5" r="0.8" />
  </Svg>
);
/** The Mouse: Cheddar's market maker. */
export const MouseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 17.5c0-4.4 3.4-8 7.5-8s7.5 3.6 7.5 8Z" />
    <circle cx="16" cy="8.5" r="2.5" />
    <path d="M19 17.5h1.5" />
    <path d="M4 17.5c-1.6 0-2 1.6-1 2.5s2.5.5 3.5-.5" />
    <circle cx="15.5" cy="13.5" r="0.6" fill="currentColor" />
  </Svg>
);
/** Mold: a voided wheel. */
export const MoldIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="10.5" cy="11" r="0.8" fill="currentColor" />
    <circle cx="13.5" cy="13.5" r="0.8" fill="currentColor" />
  </Svg>
);

// ---------- built-in wheel icons ----------

const base = {
  cheese: CheeseIcon,
  code: (p: P) => (
    <Svg {...p}>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Svg>
  ),
  clock: ClockIcon,
  calendar: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  ),
  trophy: TrophyIcon,
  rocket: (p: P) => (
    <Svg {...p}>
      <path d="M12 15.5 8.5 12C10 7 14 3.5 20.5 3.5 20.5 10 17 14 12 15.5Z" />
      <path d="M8.5 12H5l2.5-3.5h4M12 15.5V19l3.5-2.5v-4" />
      <path d="M6.5 16.5c-1.5.5-2.5 2-2.5 3.5 1.5 0 3-1 3.5-2.5" />
      <circle cx="15" cy="9" r="1.3" />
    </Svg>
  ),
  chat: (p: P) => (
    <Svg {...p}>
      <path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </Svg>
  ),
  package: (p: P) => (
    <Svg {...p}>
      <path d="M20.5 8 12 3.5 3.5 8v8l8.5 4.5 8.5-4.5Z" />
      <path d="M3.5 8 12 12.5 20.5 8M12 12.5v8M7.8 5.8l8.5 4.5" />
    </Svg>
  ),
  laptop: (p: P) => (
    <Svg {...p}>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
      <path d="M2.5 19h19" />
    </Svg>
  ),
  dice: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
    </Svg>
  ),
  flag: (p: P) => (
    <Svg {...p}>
      <path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5" />
    </Svg>
  ),
  star: (p: P) => (
    <Svg {...p}>
      <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z" />
    </Svg>
  ),
  chart: ChartIcon,
  globe: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </Svg>
  ),
  music: (p: P) => (
    <Svg {...p}>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Svg>
  ),
  gamepad: (p: P) => (
    <Svg {...p}>
      <path d="M7 6.5h10a4 4 0 0 1 4 3.6l.6 5.4a2.8 2.8 0 0 1-5 2L15 16H9l-1.6 1.5a2.8 2.8 0 0 1-5-2l.6-5.4a4 4 0 0 1 4-3.6Z" />
      <path d="M7 11.5h3M8.5 10v3M15 11h.01M17 13h.01" />
    </Svg>
  ),
  heart: (p: P) => (
    <Svg {...p}>
      <path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 8 2.5C20 15.4 12 20 12 20Z" />
    </Svg>
  ),
  bulb: (p: P) => (
    <Svg {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
    </Svg>
  ),
  ticket: (p: P) => (
    <Svg {...p}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5v2.5a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4Z" />
      <path d="M14.5 6v2M14.5 11v2M14.5 16v2" />
    </Svg>
  ),
  users: (p: P) => (
    <Svg {...p}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </Svg>
  ),
  mouse: MouseIcon,
} satisfies Record<string, (p: P) => React.ReactElement>;

export type BaseIconName = keyof typeof base;
export const BASE_ICONS = base as Record<BaseIconName, (p: P) => React.ReactElement>;
export const BASE_ICON_NAMES = Object.keys(base) as BaseIconName[];

/** ▲ 3% / ▼ 2% in green/red. Renders nothing for null or 0. */
export function Change({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={`tabular inline-flex items-center gap-0.5 font-semibold ${up ? "text-yes" : "text-no"} ${className}`}>
      <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
        <path d={up ? "M5 1 9 8H1Z" : "M5 9 1 2h8Z"} fill="currentColor" />
      </svg>
      {Math.abs(value)}%<span className="sr-only">{up ? " up" : " down"} in 24 hours</span>
    </span>
  );
}

// ---------- currency ----------

/** The Latta Cheese (Lc) coin. */
export function LattaCoin({ size = 16, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={lattaCoin.src}
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
