import type { Request } from "@knockport/core";

// ── Code generation ──────────────────────────────────────────────────────────
// Generates equivalent request code in several languages/targets.

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildUrl(request: Request): string {
  const enabled = request.params.filter((p) => p.enabled && p.key);
  if (enabled.length === 0) return request.url;
  const qs = enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
  return `${request.url}${request.url.includes("?") ? "&" : "?"}${qs}`;
}

function bodyText(request: Request): string | null {
  const b = request.body;
  if (b.type === "none") return null;
  if (b.type === "graphql") return JSON.stringify({ query: b.graphql?.query, variables: safeParse(b.graphql?.variables) });
  return b.content ?? null;
}

function safeParse(s?: string): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function generateCurl(request: Request): string {
  const lines: string[] = [`curl -X ${request.method} ${shellQuote(buildUrl(request))}`];
  for (const h of request.headers.filter((h) => h.enabled && h.key)) {
    lines.push(`  -H ${shellQuote(`${h.key}: ${h.value}`)}`);
  }
  if (request.auth.type === "bearer") {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${request.auth.bearer?.token ?? ""}`)}`);
  } else if (request.auth.type === "basic") {
    lines.push(`  -u ${shellQuote(`${request.auth.basic?.username ?? ""}:${request.auth.basic?.password ?? ""}`)}`);
  }
  const body = bodyText(request);
  if (body) lines.push(`  --data ${shellQuote(body)}`);
  return lines.join(" \\\n");
}

export function generateJsFetch(request: Request): string {
  const headers: Record<string, string> = {};
  for (const h of request.headers.filter((h) => h.enabled && h.key)) headers[h.key] = h.value;
  if (request.auth.type === "bearer") headers.Authorization = `Bearer ${request.auth.bearer?.token ?? ""}`;

  const body = bodyText(request);
  const opts: string[] = [`  method: ${JSON.stringify(request.method)},`];
  if (Object.keys(headers).length > 0) opts.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, "\n  ")},`);
  if (body) opts.push(`  body: ${JSON.stringify(body)},`);

  return `const response = await fetch(${JSON.stringify(buildUrl(request))}, {\n${opts.join("\n")}\n});\n\nconst data = await response.json();\nconsole.log(data);`;
}

export function generatePython(request: Request): string {
  const headers: Record<string, string> = {};
  for (const h of request.headers.filter((h) => h.enabled && h.key)) headers[h.key] = h.value;
  if (request.auth.type === "bearer") headers.Authorization = `Bearer ${request.auth.bearer?.token ?? ""}`;

  const lines: string[] = ["import requests", ""];
  lines.push(`url = ${pyStr(buildUrl(request))}`);
  if (Object.keys(headers).length > 0) {
    lines.push("headers = {");
    for (const [k, v] of Object.entries(headers)) lines.push(`    ${pyStr(k)}: ${pyStr(v)},`);
    lines.push("}");
  }
  const body = bodyText(request);
  const args = ["url"];
  if (Object.keys(headers).length > 0) args.push("headers=headers");
  if (body) lines.push(`payload = ${pyStr(body)}`), args.push("data=payload");

  lines.push("");
  lines.push(`response = requests.${request.method.toLowerCase()}(${args.join(", ")})`);
  lines.push("print(response.json())");
  return lines.join("\n");
}

export type CodegenTarget = "curl" | "javascript" | "python";

export function generateCode(request: Request, target: CodegenTarget): string {
  switch (target) {
    case "curl":
      return generateCurl(request);
    case "javascript":
      return generateJsFetch(request);
    case "python":
      return generatePython(request);
  }
}
