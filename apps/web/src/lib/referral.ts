import "server-only";
import { DEFAULT_REFERRAL, type ReferralConfig } from "@cheddar/exchange";
import { env } from "./env";

/** Cookie holding an invite code between clicking a link and finishing sign-in. */
export const REFERRAL_COOKIE = "cheddar_ref";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Referral rules, overridable from the environment (amounts are in whole Latta). */
export const referralConfig: ReferralConfig = {
  referrerTicks: Math.round(num(process.env.CHEDDAR_REFERRAL_REFERRER_LATTA, DEFAULT_REFERRAL.referrerTicks / 100) * 100),
  refereeTicks: Math.round(num(process.env.CHEDDAR_REFERRAL_REFEREE_LATTA, DEFAULT_REFERRAL.refereeTicks / 100) * 100),
  minVolumeTicks: Math.round(num(process.env.CHEDDAR_REFERRAL_MIN_TRADE_LATTA, DEFAULT_REFERRAL.minVolumeTicks / 100) * 100),
};

/** The link someone shares: signs people up through them, then lands on `to` (default the home page). */
export function inviteUrl(code: string, to?: string): string {
  const base = `${env.appUrl}/r/${code}`;
  return to && to !== "/" ? `${base}?to=${encodeURIComponent(to)}` : base;
}
