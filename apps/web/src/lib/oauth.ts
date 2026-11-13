import "server-only";
import { cookies } from "next/headers";
import { decrypt, encrypt, pkceChallenge, randomToken } from "./crypto";
import { env, requireEnv, secureCookies } from "./env";

/**
 * Two OAuth providers, both authorization-code with PKCE + state:
 *  - Hack Club Auth (OIDC): who you are. Endpoints from its discovery document.
 *  - Hackatime: links your coding account so Churn can pay you.
 */
export const providers = {
  hca: {
    authorize: "https://auth.hackclub.com/oauth/authorize",
    token: "https://auth.hackclub.com/oauth/token",
    scope: "openid profile email slack_id verification_status",
    callbackPath: "/api/auth/callback/hackclub",
    clientId: () => requireEnv("hcaClientId"),
    clientSecret: () => requireEnv("hcaClientSecret"),
  },
  hackatime: {
    authorize: "https://hackatime.hackclub.com/oauth/authorize",
    token: "https://hackatime.hackclub.com/oauth/token",
    scope: "profile read",
    callbackPath: "/api/hackatime/callback",
    clientId: () => requireEnv("hackatimeClientId"),
    clientSecret: () => requireEnv("hackatimeClientSecret"),
  },
} as const;

export type Provider = keyof typeof providers;

interface Pending {
  state: string;
  verifier: string;
  returnTo: string;
}

const cookieName = (p: Provider) => `cheddar_oauth_${p}`;

/** Only same-site relative paths, so the login flow can't be used as an open redirect. */
export function safeReturnTo(v: string | null | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export function redirectUri(p: Provider): string {
  return env.appUrl + providers[p].callbackPath;
}

/** Returns the provider URL to send the browser to. */
export async function beginOAuth(p: Provider, returnTo: string): Promise<string> {
  const cfg = providers[p];
  const pending: Pending = { state: randomToken(24), verifier: randomToken(48), returnTo: safeReturnTo(returnTo) };
  (await cookies()).set(cookieName(p), encrypt(JSON.stringify(pending)), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const url = new URL(cfg.authorize);
  url.search = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: cfg.scope,
    state: pending.state,
    code_challenge: pkceChallenge(pending.verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export class OAuthError extends Error {}

/** Validates the callback and exchanges the code for tokens. */
export async function finishOAuth(p: Provider, callbackUrl: URL) {
  const jar = await cookies();
  const raw = jar.get(cookieName(p))?.value;
  jar.delete(cookieName(p));
  const err = callbackUrl.searchParams.get("error");
  if (err) throw new OAuthError(callbackUrl.searchParams.get("error_description") ?? err);
  if (!raw) throw new OAuthError("Your login took too long or was opened in another browser. Please try again.");
  let pending: Pending;
  try {
    pending = JSON.parse(decrypt(raw)) as Pending;
  } catch {
    throw new OAuthError("Login state was invalid. Please try again.");
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code || callbackUrl.searchParams.get("state") !== pending.state) {
    throw new OAuthError("Login state did not match. Please try again.");
  }

  const cfg = providers[p];
  const res = await fetch(cfg.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(p),
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      code_verifier: pending.verifier,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    const why = (body.error_description ?? body.error ?? `HTTP ${res.status}`) as string;
    throw new OAuthError(`Could not finish signing in (${why}).`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined,
    returnTo: pending.returnTo,
  };
}

export async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new OAuthError(`Could not read your profile (HTTP ${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}
