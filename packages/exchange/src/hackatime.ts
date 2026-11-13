/**
 * Minimal Hackatime API client for Churn.
 *
 * Verified against production on 2026-11-13:
 *   - GET /api/v1/users/{id}/stats?total_seconds=true&no_ai_coding=true -> { total_seconds }
 *     Works anonymously when the user's stats are public, else 403
 *     ("user has disabled public stats"). With a Bearer token, use id "my".
 *   - GET /api/v1/users/{id}/trust_factor -> { trust_level: blue|red|green, trust_value }
 *     Public for every user. "red" = banned.
 *   - Look users up by numeric Hackatime id or Slack id. Username lookup is NOT safe: "Brody"
 *     resolved to a different account than id 694. Slack id U083T3ZP6AV and its numeric id
 *     returned identical totals.
 */

export type TrustLevel = "blue" | "red" | "green";

export interface HackatimeSnapshot {
  lifetimeNonAiSeconds: number;
  trustLevel: TrustLevel;
}

/** Who to look up: the linked numeric Hackatime id, or a Slack id (for unlinked Mouse funders). */
export interface HackatimeLookup {
  hackatimeUserId?: string | null;
  slackId?: string | null;
  bearerToken?: string;
}

export interface HackatimeClient {
  snapshot(user: HackatimeLookup): Promise<HackatimeSnapshot>;
}

/** The identifier to put in Hackatime URLs, preferring the numeric id. Never a username. */
export function hackatimeIdentifier(user: HackatimeLookup): string {
  if (user.hackatimeUserId) {
    if (!/^\d+$/.test(user.hackatimeUserId)) throw new HackatimeError("Hackatime user id must be numeric");
    return user.hackatimeUserId;
  }
  if (user.slackId && /^[UW][A-Z0-9]{5,}$/.test(user.slackId)) return user.slackId;
  throw new HackatimeError("need a numeric Hackatime id or a Slack id");
}

export class HackatimeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HackatimeError";
  }
}

/** Fixed start so a rolling "10 years ago" default never drops old hours. */
const STATS_START = "2000-01-01T00:00:00Z";

export class HackatimeHttpClient implements HackatimeClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://hackatime.hackclub.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  async snapshot(user: HackatimeLookup): Promise<HackatimeSnapshot> {
    const id = hackatimeIdentifier(user);
    const [lifetimeNonAiSeconds, trustLevel] = await Promise.all([this.nonAiSeconds(id, user.bearerToken), this.trust(id)]);
    return { lifetimeNonAiSeconds, trustLevel };
  }

  private async nonAiSeconds(id: string, bearerToken?: string): Promise<number> {
    const qs = `total_seconds=true&no_ai_coding=true&start_date=${encodeURIComponent(STATS_START)}`;
    let res = await this.get(`/api/v1/users/${id}/stats?${qs}`);
    if (res.status === 403 && bearerToken) {
      res = await this.get(`/api/v1/users/my/stats?${qs}`, bearerToken);
    }
    const body = await this.json(res);
    const s = (body as { total_seconds?: unknown }).total_seconds;
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) {
      throw new HackatimeError("unexpected stats response", res.status);
    }
    return Math.floor(s);
  }

  private async trust(id: string): Promise<TrustLevel> {
    const body = await this.json(await this.get(`/api/v1/users/${id}/trust_factor`));
    const level = (body as { trust_level?: unknown }).trust_level;
    if (level !== "blue" && level !== "red" && level !== "green") {
      throw new HackatimeError(`unexpected trust level ${String(level)}`);
    }
    return level;
  }

  private async get(path: string, bearer?: string): Promise<Response> {
    try {
      return await this.fetchImpl(this.baseUrl + path, {
        headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new HackatimeError(`Hackatime request failed: ${(e as Error).message}`);
    }
  }

  private async json(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 200);
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? msg;
      } catch {
        /* keep raw text */
      }
      throw new HackatimeError(`Hackatime ${res.status}: ${msg}`, res.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HackatimeError("Hackatime returned invalid JSON", res.status);
    }
  }
}
