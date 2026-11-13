import { BASE_ICONS, type BaseIconName } from "./Icons";

/** A cheddar wedge with holes. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 22 L18 6 L29 13 L29 25 L3 25 Z" fill="var(--accent)" />
      <path d="M3 22 L29 13 L29 16 L3 25 Z" fill="var(--accent)" opacity="0.65" />
      <circle cx="12" cy="20.5" r="1.8" fill="var(--bg)" opacity="0.85" />
      <circle cx="20" cy="17" r="1.3" fill="var(--bg)" opacity="0.85" />
      <circle cx="24.5" cy="21.5" r="1.6" fill="var(--bg)" opacity="0.85" />
      <circle cx="18" cy="12" r="1" fill="var(--bg)" opacity="0.85" />
    </svg>
  );
}

/** Icon and tint per category, used when a wheel has no icon of its own. */
const CATEGORY_LOOK: Record<string, { icon: BaseIconName; tint: string }> = {
  "Hack Club": { icon: "flag", tint: "#ec3750" },
  Hackatime: { icon: "clock", tint: "#2f6fde" },
  Events: { icon: "ticket", tint: "#7c3aed" },
  YSWS: { icon: "package", tint: "#1f9d5c" },
  Slack: { icon: "chat", tint: "#0e7490" },
  Tech: { icon: "laptop", tint: "#475569" },
  Fun: { icon: "dice", tint: "#c2410c" },
};
const FALLBACK_LOOK = { icon: "cheese" as BaseIconName, tint: "#e09a12" };

export function categoryLook(category: string | null | undefined) {
  return (category && CATEGORY_LOOK[category]) || FALLBACK_LOOK;
}

/** The built-in icon name in an "svg:<name>" value, if it is one we have. */
export function baseIconName(icon: string | null | undefined): BaseIconName | null {
  if (!icon?.startsWith("svg:")) return null;
  const name = icon.slice(4) as BaseIconName;
  return name in BASE_ICONS ? name : null;
}

/**
 * Square tile for a wheel: its uploaded image, or a built-in icon on a soft tint of the category
 * colour (the category's own icon when the wheel has none).
 */
export function WheelIcon({
  icon,
  category,
  size = 40,
}: {
  icon?: string | null;
  category: string | null | undefined;
  size?: number;
}) {
  const radius = size >= 56 ? 12 : size >= 36 ? 8 : 6;
  if (icon?.startsWith("data:image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        width={size}
        height={size}
        className="shrink-0 bg-surface-2 object-cover"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  const look = categoryLook(category);
  const Glyph = BASE_ICONS[baseIconName(icon) ?? look.icon];
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        color: look.tint,
        background: `color-mix(in srgb, ${look.tint} 16%, var(--surface))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${look.tint} 26%, transparent)`,
      }}
      aria-hidden="true"
    >
      <Glyph size={Math.round(size * 0.55)} strokeWidth={size >= 40 ? 1.8 : 2} />
    </div>
  );
}

export function Avatar({ slackId, name, size = 28 }: { slackId: string | null; name: string | null; size?: number }) {
  const initial = (name ?? "?").slice(0, 1).toUpperCase();
  if (!slackId) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-surface-3 text-xs font-semibold"
        style={{ width: size, height: size }}
      >
        {initial}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cachet.dunkirk.sh/users/${slackId}/r`}
      alt=""
      width={size}
      height={size}
      className="rounded-full bg-surface-3 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
