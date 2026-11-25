import { formatChance, formatLatta } from "./format";

/** The slice of a wheel an embed needs. Kept structural so the card and the OG image share one description. */
export interface EmbedWheel {
  title: string;
  status: string;
  tradingPausedAt: Date | null;
  volumeTicks: number;
  wedges: { label: string; chance: number | null }[];
}

export interface MarketEmbedState {
  /** Big figure: "2%" on a yes/no wheel, or "Citadel 64%" when there are several outcomes. */
  chanceLabel: string;
  /** "chance" for a yes/no wheel. Empty when `chanceLabel` already names an outcome. */
  chanceCaption: string;
  statusLabel: string;
  volumeLabel: string;
  /** One line for Discord, Slack, and other unfurls. */
  description: string;
  /** Highest chance first, at most three. */
  outcomes: { label: string; chance: string }[];
}

/** Current state of a market, as link previews and the iframe card should show it. */
export function marketEmbedState(wheel: EmbedWheel, outcomeProposed: boolean): MarketEmbedState {
  const ranked = [...wheel.wedges].sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
  const binary = wheel.wedges.length <= 1;
  const lead = ranked[0];
  const chanceLabel = binary
    ? formatChance(wheel.wedges[0]?.chance)
    : lead
      ? `${lead.label} ${formatChance(lead.chance)}`
      : "—";
  const chanceCaption = binary ? "chance" : "";
  const statusLabel =
    wheel.status === "resolved"
      ? "Resolved"
      : wheel.status === "moldy"
        ? "Void"
        : outcomeProposed || wheel.status === "ripening"
          ? "Outcome proposed"
          : wheel.tradingPausedAt
            ? "Paused"
            : wheel.status === "closed"
              ? "Closed"
              : "Open";
  const volumeLabel = `${formatLatta(wheel.volumeTicks)} vol`;
  const figure = chanceCaption ? `${chanceLabel} ${chanceCaption}` : chanceLabel;
  return {
    chanceLabel,
    chanceCaption,
    statusLabel,
    volumeLabel,
    description: `${figure} · ${volumeLabel} · ${statusLabel}`,
    outcomes: ranked.slice(0, 3).map((w) => ({ label: w.label, chance: formatChance(w.chance) })),
  };
}
