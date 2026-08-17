// OAuth2 token-flow orchestration over the tropel core-wasm auth tier.
// Pure builders + parsers live in @tropel/core-wasm (tropel-auth::oauth);
// this module adds the ONE piece tropel deliberately leaves to the embedder:
// performing the token-endpoint HTTP round-trip and storing the result on
// an AuthConfig.

import type { Request, Response } from "./types";
import {
  generatePkcePair,
  oauth2BuildAuthorizeUrl,
  oauth2BuildTokenRequest,
  oauth2IsTokenExpired,
  oauth2ParseTokenResponse,
  oauth2StoreToken,
} from "@tropel/core-wasm";

/** The transport used for token-endpoint POSTs (any conforming implementation). */
export type OAuth2Transport = {
  execute(request: Request, options?: { signal?: AbortSignal; timeout?: number }): Promise<Response>;
};

export type StoredAuth = {
  accessToken: string;
  /** OIDC id_token from the exchange (use with `useIdToken`). */
  idToken?: string;
  refreshToken?: string;
  tokenType: string;
  /** Absolute UNIX seconds; absent = no expiry advertised. */
  expiresAt?: number;
  scope?: string;
};

/**
 * POST the built token request through the transport. Returns the raw
 * response body — callers parse it so error text (§5.2) can surface.
 */
async function postTokenRequest(
  built: ReturnType<typeof oauth2BuildTokenRequest>,
  transport: OAuth2Transport,
  signal?: AbortSignal,
): Promise<string> {
  const request: Request = {
    id: `oauth2-token-${Date.now()}`,
    name: "OAuth2 token exchange",
    method: "POST",
    url: built.url,
    headers: [
      { key: "Content-Type", value: built.content_type, enabled: true },
      ...(built.basic_auth_header
        ? [{ key: "Authorization", value: built.basic_auth_header, enabled: true }]
        : []),
      { key: "Accept", value: "application/json", enabled: true },
    ],
    params: [],
    body: { type: "text", content: built.body },
    auth: { type: "none" },
  };
  const res = await transport.execute(request, { signal, timeout: 30_000 });
  const body = res.body ?? "";
  return body.trim() === "" ? "{}" : body;
}

const EMPTY_STORED: StoredAuth = { accessToken: "", tokenType: "" };

/** Store a token response on the auth record (absolute `expiresAt`). */
export function storeToken(auth: StoredAuth, body: string): StoredAuth {
  const parsed = oauth2ParseTokenResponse(body);
  const stored = oauth2StoreToken(parsed);
  return {
    ...auth,
    accessToken: stored.access_token,
    idToken: parsed.id_token ?? auth.idToken,
    refreshToken: stored.refresh_token ?? auth.refreshToken,
    tokenType: stored.token_type || "Bearer",
    expiresAt: stored.expires_at ?? undefined,
    scope: stored.scope ?? auth.scope,
  };
}

/** Build the authorize URL for authorization_code/implicit + fresh PKCE pair. */
export function startAuthorize(params: {
  authUrl: string;
  clientId: string;
  redirectUri?: string;
  scopes?: string[];
  pkce?: boolean;
  state?: string;
  /** `code` (default, authorization_code) or `token` (implicit). */
  responseType?: "code" | "token";
}): { url: string; state: string; codeVerifier?: string } {
  const implicit = params.responseType === "token";
  const verifier = params.pkce && !implicit ? generatePkcePair() : undefined;
  const res = oauth2BuildAuthorizeUrl({
    auth_url: params.authUrl,
    client_id: params.clientId,
    redirect_uri: params.redirectUri ?? "",
    scopes: params.scopes ?? [],
    response_type: params.responseType ?? "code",
    pkce: verifier
      ? { code_verifier: verifier.codeVerifier, code_challenge_method: verifier.codeChallengeMethod }
      : undefined,
    state: params.state,
  });
  return {
    url: res.url,
    state: res.state ?? "",
    codeVerifier: res.code_verifier ?? undefined,
  };
}

/** Exchange an authorization_code (+ PKCE verifier if used) for tokens. */
export async function exchangeCode(params: {
  code: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  codeVerifier?: string;
  authMethod?: "basic" | "post_body";
  transport: OAuth2Transport;
  signal?: AbortSignal;
}): Promise<StoredAuth> {
  const built = oauth2BuildTokenRequest({
    grant_type: "authorization_code",
    token_url: params.tokenUrl,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    auth_method: params.authMethod ?? "basic",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  return storeToken(EMPTY_STORED, await postTokenRequest(built, params.transport, params.signal));
}

/** client_credentials / password grant — direct token fetch. */
export async function fetchAccessToken(params: {
  grantType: "client_credentials" | "password";
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  authMethod?: "basic" | "post_body";
  transport: OAuth2Transport;
  signal?: AbortSignal;
}): Promise<StoredAuth> {
  const built = oauth2BuildTokenRequest({
    grant_type: params.grantType,
    token_url: params.tokenUrl,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    auth_method: params.authMethod ?? "basic",
    username: params.username,
    password: params.password,
  });
  return storeToken(EMPTY_STORED, await postTokenRequest(built, params.transport, params.signal));
}

/** refresh_token grant. */
export async function refreshAccessToken(params: {
  refreshToken: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  authMethod?: "basic" | "post_body";
  scopes?: string[];
  transport: OAuth2Transport;
  signal?: AbortSignal;
}): Promise<StoredAuth> {
  const built = oauth2BuildTokenRequest({
    grant_type: "refresh_token",
    token_url: params.tokenUrl,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    auth_method: params.authMethod ?? "basic",
    refresh_token: params.refreshToken,
    scopes: params.scopes ?? [],
  });
  const stored = storeToken(EMPTY_STORED, await postTokenRequest(built, params.transport, params.signal));
  // RFC 6749 §6: refresh tokens may be rotated; keep the old one when the
  // server doesn't issue a new one.
  if (!stored.refreshToken) stored.refreshToken = params.refreshToken;
  return stored;
}

/** Is the stored auth expired (skew default 60 s)? */
export function isTokenExpired(auth: StoredAuth, skewSecs = 60): boolean {
  return !auth.accessToken || oauth2IsTokenExpired({
    access_token: auth.accessToken,
    token_type: auth.tokenType || "Bearer",
    refresh_token: auth.refreshToken ?? null,
    expires_at: auth.expiresAt ?? null,
    scope: auth.scope ?? null,
  }, skewSecs);
}

/** Copy a stored token set back onto `oauth2` fields for persistence. */
export function writeTokensToOauth2(
  oauth2: Record<string, unknown>,
  stored: StoredAuth,
): Record<string, unknown> {
  oauth2.accessToken = stored.accessToken;
  oauth2.refreshToken = stored.refreshToken;
  oauth2.tokenType = stored.tokenType;
  oauth2.expiresAt = stored.expiresAt;
  oauth2.scope = stored.scope;
  if (stored.idToken !== undefined) oauth2.idToken = stored.idToken;
  return oauth2;
}

/**
 * Ensure the OAuth2 token on `auth` is usable and attach it to a resolved
 * request. When the token is expired and a refresh_token + token_url exist,
 * refresh through the transport first. Returns the (possibly refreshed)
 * attachment result — null when nothing was attached. Mutates
 * `auth.oauth2` in place so callers can persist the new token state.
 * No-op (no throw) when the wasm tier is still initializing.
 */
export async function ensureOAuth2AndAttach(
  request: { headers: { key: string; value: string; enabled?: boolean }[]; params?: { key: string; value: string; enabled?: boolean }[] },
  auth: { type: string; oauth2?: Record<string, any> },
  transport: OAuth2Transport,
  signal?: AbortSignal,
): Promise<{ attached: boolean; refreshed: boolean; stored?: StoredAuth }> {
  const o2 = auth.oauth2;
  if (auth.type !== "oauth2" || !o2?.accessToken) return { attached: false, refreshed: false };

  const storedNow: StoredAuth = {
    accessToken: o2.accessToken,
    idToken: o2.idToken,
    refreshToken: o2.refreshToken,
    tokenType: o2.tokenType ?? "Bearer",
    expiresAt: o2.expiresAt,
    scope: o2.scope,
  };
  let refreshed = false;
  let stored: StoredAuth | undefined;
  if (isTokenExpired(storedNow) && o2.refreshToken && o2.tokenUrl) {
    try {
      const fresh = await refreshAccessToken({
        refreshToken: o2.refreshToken,
        tokenUrl: o2.tokenUrl,
        clientId: o2.clientId ?? "",
        clientSecret: o2.clientSecret,
        authMethod: o2.authMethod,
        scopes: o2.scopes ?? [],
        transport,
        signal,
      });
      writeTokensToOauth2(o2, fresh);
      refreshed = true;
      stored = fresh;
    } catch {
      // Refresh failed — fall back to the (expired) token; the server gives
      // the definitive answer.
    }
  }
  const current = o2 as Record<string, any>;
  const token = current.useIdToken && current.idToken ? current.idToken : current.accessToken;
  if (!token) return { attached: false, refreshed, stored };
  attachToken(request, {
    accessToken: token,
    tokenType: current.tokenType ?? "Bearer",
    sendTokenIn: current.sendTokenIn,
    headerPrefix: current.headerPrefix,
    queryParamName: current.queryParamName,
  });
  return { attached: true, refreshed, stored };
}

/**
 * Attach the token to a request (header `Authorization: <prefix> <token>` or
 * query param). Pure JS mirror of tropel's `attach_token`: runs on the sync
 * send path where the wasm tier may still be initializing (the token itself
 * was produced by that tier, so placement here cannot drift).
 */
export function attachToken(
  request: { headers: { key: string; value: string; enabled?: boolean }[]; params?: { key: string; value: string; enabled?: boolean }[] },
  auth: StoredAuth & { sendTokenIn?: "header" | "query"; headerPrefix?: string; queryParamName?: string },
): void {
  const token = auth.accessToken;
  if ((auth.sendTokenIn ?? "header") === "query") {
    const params = request.params ?? [];
    const key = auth.queryParamName?.trim() || "access_token";
    request.params = [
      ...params.filter((p) => p.key !== key),
      { key, value: token, enabled: true },
    ];
    return;
  }
  const prefix =
    auth.headerPrefix?.trim() ||
    auth.tokenType?.trim() ||
    "Bearer";
  request.headers = [
    ...request.headers.filter((h) => h.key.toLowerCase() !== "authorization"),
    { key: "Authorization", value: `${prefix} ${token}`, enabled: true },
  ];
}
