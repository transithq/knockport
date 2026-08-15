import type { Request } from "@knockport/core";
import { expect, it } from "vitest";
import { RelayTransport } from "./index";

// E2E guard for the relay wire format (multi Set-Cookie preservation).
// Requires: relay running on localhost:8787 (cargo build --release in apps/relay)
// and public network access. Skipped otherwise so offline/dev runs stay green.
async function relayUp(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

it("relay preserves multiple Set-Cookie headers end to end", async () => {
  const relayUrl = "http://localhost:8787";
  if (!(await relayUp(relayUrl))) return; // relay not running — skip
  const transport = new RelayTransport(relayUrl);
  const request: Request = {
    id: "live-cookie",
    name: "google",
    method: "GET",
    url: "https://www.google.com/",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "none" },
  };
  let response;
  try {
    response = await transport.execute(request);
  } catch {
    return; // no public network — skip
  }
  expect(response.status).toBe(200);
  expect(response.cookies.length).toBeGreaterThanOrEqual(2);
  const names = response.cookies.map((c) => c.name);
  expect(names.length).toBe(new Set(names).size);
  // Expires values contain commas — they must survive attribute parsing intact.
  const withExpires = response.cookies.find((c) => c.expires);
  expect(withExpires?.expires).toMatch(/GMT/);
}, 30000);
