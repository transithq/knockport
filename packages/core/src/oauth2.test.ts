import { createRequire } from "node:module";
import { initCoreWasm } from "@tropel/core-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  attachToken,
  isTokenExpired,
  startAuthorize,
  type StoredAuth,
} from "./oauth2";

// Same wasm bundle apps/web lazy-loads; the auth tier (PKCE/authorize/token
// builders) ships inside it (Tropel PR #121).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const wasmPath = join(dirname(require.resolve("@tropel/core-wasm")), "..", "pkg", "tropel_core_wasm_bg.wasm");
const wasmBytes = readFileSync(wasmPath);

beforeAll(async () => {
  const ok = await initCoreWasm({ wasmBytes });
  expect(ok).toBe(true);
});

describe("startAuthorize (tropel oauth tier)", () => {
  it("builds an authorize URL with client, scope and state", () => {
    const res = startAuthorize({
      authUrl: "https://auth.example.com/authorize",
      clientId: "cid",
      redirectUri: "https://cb",
      scopes: ["read", "write"],
    });
    expect(res.url.startsWith("https://auth.example.com/authorize?response_type=code")).toBe(true);
    expect(res.url).toContain("client_id=cid");
    expect(res.state.length).toBeGreaterThan(0);
    expect(res.codeVerifier).toBeUndefined();
  });

  it("adds PKCE challenge for authorization_code when enabled", () => {
    const res = startAuthorize({
      authUrl: "https://auth.example.com/authorize",
      clientId: "cid",
      pkce: true,
    });
    expect(res.url).toContain("code_challenge_method=S256");
    expect(res.url).toContain("code_challenge=");
    expect(res.codeVerifier?.length).toBe(128);
  });

  it("omits PKCE and code for implicit response_type=token", () => {
    const res = startAuthorize({
      authUrl: "https://auth.example.com/authorize",
      clientId: "cid",
      responseType: "token",
      pkce: true,
    });
    expect(res.url).toContain("response_type=token");
    expect(res.url).not.toContain("code_challenge");
    expect(res.codeVerifier).toBeUndefined();
  });
});

describe("isTokenExpired", () => {
  it("missing token is always treated as expired", () => {
    expect(isTokenExpired({ accessToken: "", tokenType: "Bearer" })).toBe(true);
  });
  it("no expiry -> never expired", () => {
    expect(isTokenExpired({ accessToken: "t", tokenType: "Bearer" })).toBe(false);
  });
  it("future expiry is not expired; past expiry is", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenExpired({ accessToken: "t", tokenType: "Bearer", expiresAt: now + 3600 })).toBe(false);
    expect(isTokenExpired({ accessToken: "t", tokenType: "Bearer", expiresAt: now - 10 })).toBe(true);
  });
});

describe("attachToken", () => {
  const base = () => ({
    headers: [{ key: "Accept", value: "application/json", enabled: true }],
    params: [] as { key: string; value: string; enabled?: boolean }[],
  });

  it("attaches an Authorization header with the token_type prefix", () => {
    const r = base();
    const auth: StoredAuth = { accessToken: "abc", tokenType: "Bearer" };
    attachToken(r, auth);
    expect(r.headers.find((h) => h.key === "Authorization")?.value).toBe("Bearer abc");
  });

  it("headerPrefix overrides the token_type prefix", () => {
    const r = base();
    const auth: StoredAuth = { accessToken: "abc", tokenType: "Bearer" };
    attachToken(r, { ...auth, headerPrefix: "JWT" });
    expect(r.headers.find((h) => h.key === "Authorization")?.value).toBe("JWT abc");
  });

  it("replaces an existing Authorization header instead of duplicating", () => {
    const r = base();
    r.headers.push({ key: "authorization", value: "Bearer old", enabled: true });
    const auth: StoredAuth = { accessToken: "new", tokenType: "Bearer" };
    attachToken(r, auth);
    const authHeaders = r.headers.filter((h) => h.key.toLowerCase() === "authorization");
    expect(authHeaders.length).toBe(1);
    expect(authHeaders[0].value).toBe("Bearer new");
  });

  it("attaches a query param when sendTokenIn=query", () => {
    const r = base();
    const auth: StoredAuth = { accessToken: "tok", tokenType: "Bearer" };
    attachToken(r, { ...auth, sendTokenIn: "query", queryParamName: "token" });
    expect(r.params).toEqual([{ key: "token", value: "tok", enabled: true }]);
    expect(r.headers.find((h) => h.key === "Authorization")).toBeUndefined();
  });

  it("query param name defaults to access_token", () => {
    const r = base();
    const auth: StoredAuth = { accessToken: "tok", tokenType: "Bearer" };
    attachToken(r, { ...auth, sendTokenIn: "query" });
    expect(r.params[0].key).toBe("access_token");
  });
});
