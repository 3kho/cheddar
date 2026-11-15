import lattaCoin from "@/assets/latta-coin.png";
import {
  Activity as LActivity,
  Calendar as LCalendar,
  ChartLine as LChartLine,
  Check as LCheck,
  ChevronDown as LChevronDown,
  CircleCheck as LCircleCheck,
  Clock as LClock,
  Code as LCode,
  Coins as LCoins,
  Dices as LDices,
  Flag as LFlag,
  Flame as LFlame,
  Gamepad2 as LGamepad2,
  Globe as LGlobe,
  Heart as LHeart,
  Image as LImage,
  Laptop as LLaptop,
  Lightbulb as LLightbulb,
  Link as LLink,
  ListPlus as LListPlus,
  MessageCircle as LMessageCircle,
  Monitor as LMonitor,
  Moon as LMoon,
  Music as LMusic,
  Package as LPackage,
  Pause as LPause,
  Pencil as LPencil,
  Plus as LPlus,
  Rocket as LRocket,
  Search as LSearch,
  ShieldCheck as LShieldCheck,
  Sparkle as LSparkle,
  Sparkles as LSparkles,
  Star as LStar,
  Sun as LSun,
  Ticket as LTicket,
  TriangleAlert as LTriangleAlert,
  Trophy as LTrophy,
  Upload as LUpload,
  Users as LUsers,
  X as LX,
  type LucideProps,
} from "lucide-react";

/** UI icons come from Lucide (https://lucide.dev); the Cheddar characters below are custom. All use currentColor. */
type P = { size?: number; className?: string; strokeWidth?: number };

const lucide = (Icon: React.ComponentType<LucideProps>) => (p: P) => <Icon size={p.size ?? 16} strokeWidth={p.strokeWidth ?? 2} className={p.className} aria-hidden="true" />;

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

export const SearchIcon = lucide(LSearch);
export const FlameIcon = lucide(LFlame);
export const SparkIcon = lucide(LSparkle);
export const ClockIcon = lucide(LClock);
export const ChartIcon = lucide(LChartLine);
export const TrophyIcon = lucide(LTrophy);
export const CheckIcon = lucide(LCircleCheck);
export const TickIcon = lucide(LCheck);
export const ActivityIcon = lucide(LActivity);
export const PencilIcon = lucide(LPencil);
export const CalendarIcon = lucide(LCalendar);
export const ListPlusIcon = lucide(LListPlus);
export const PlusIcon = lucide(LPlus);
export const XIcon = lucide(LX);
export const ChevronDownIcon = lucide(LChevronDown);
export const ImageIcon = lucide(LImage);
export const UploadIcon = lucide(LUpload);
export const SunIcon = lucide(LSun);
export const MoonIcon = lucide(LMoon);
export const MonitorIcon = lucide(LMonitor);
export const AlertIcon = lucide(LTriangleAlert);
export const PauseIcon = lucide(LPause);
export const CoinsIcon = lucide(LCoins);
export const SparklesIcon = lucide(LSparkles);
export const LinkIcon = lucide(LLink);
export const ShieldIcon = lucide(LShieldCheck);

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
  clock: ClockIcon,
  trophy: TrophyIcon,
  chart: ChartIcon,
  mouse: MouseIcon,
  calendar: CalendarIcon,
  code: lucide(LCode),
  rocket: lucide(LRocket),
  chat: lucide(LMessageCircle),
  package: lucide(LPackage),
  laptop: lucide(LLaptop),
  dice: lucide(LDices),
  flag: lucide(LFlag),
  star: lucide(LStar),
  globe: lucide(LGlobe),
  music: lucide(LMusic),
  gamepad: lucide(LGamepad2),
  heart: lucide(LHeart),
  bulb: lucide(LLightbulb),
  ticket: lucide(LTicket),
  users: lucide(LUsers),
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
