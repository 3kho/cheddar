import "server-only";
import { readdirSync } from "node:fs";
import path from "node:path";

export interface MarketIcon {
  /** What is saved on a market: "img:<file name>". */
  value: string;
  label: string;
  src: string;
}

const EXT = /\.(png|webp|jpe?g|gif)$/i;

/** The pictures in apps/web/public/market-icons, which the icon picker offers. Add files there to add icons. */
export function listMarketIcons(): MarketIcon[] {
  let files: string[] = [];
  try {
    files = readdirSync(path.join(process.cwd(), "public", "market-icons"));
  } catch {
    return [];
  }
  return files
    .filter((f) => EXT.test(f) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({ value: `img:${f}`, label: f.replace(EXT, "").replace(/[-_]+/g, " "), src: `/market-icons/${f}` }));
}
