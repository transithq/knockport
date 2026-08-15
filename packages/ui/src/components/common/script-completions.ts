import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { jsCompletions } from "./script-snippets";

// ── Script API completions (kp.* / pm.* / bru.*) ─────────────────────────────
// Kept in sync with the engine bridges in packages/engine/src/test-runner.ts:
// kp is the canonical namespace, pm/bru are the Postman-compatible aliases,
// and chai.expect / kp.expect provide assertions.

interface Entry {
  label: string;
  display?: string;
  info?: string;
  type: "function" | "property" | "class" | "keyword";
  apply?: string;
}

const RESPONSE_MEMBERS: Entry[] = [
  { label: "code", display: "code", info: "numeric HTTP status (200)", type: "property" },
  { label: "status", display: "status", info: "status reason text (\"OK\")", type: "property" },
  { label: "responseTime", display: "responseTime", info: "total request time in ms", type: "property" },
  { label: "body", display: "body", info: "raw response body string", type: "function", apply: "body" },
  { label: "json", display: "json()", info: "parse the body as JSON", type: "function", apply: "json()" },
  { label: "headers", display: "headers", info: "HeaderList — use .get(name)", type: "property" },
  { label: "cookies", display: "cookies", info: "response cookies list", type: "property" },
];

const VAR_SCOPES = (ns: string): Entry[] => [
  { label: "get", display: "get(key)", info: `${ns} variable`, type: "function", apply: 'get("key")' },
  { label: "set", display: "set(key, value)", info: `${ns} variable`, type: "function", apply: 'set("key", "value")' },
  { label: "unset", display: "unset(key)", info: `${ns} variable`, type: "function", apply: 'unset("key")' },
  { label: "toObject", display: "toObject()", info: "all values as an object", type: "function", apply: "toObject()" },
];

const KP_ROOT: Record<string, Entry[]> = {
  response: RESPONSE_MEMBERS,
  variables: VAR_SCOPES("request"),
  environment: [...VAR_SCOPES("environment"), { label: "has", display: "has(key)", type: "function", apply: 'has("key")' }, { label: "clear", display: "clear()", type: "function", apply: "clear()" }],
  collectionVariables: VAR_SCOPES("collection"),
  globals: VAR_SCOPES("global"),
  request: [
    { label: "url", display: "url", info: "request URL", type: "property" },
    { label: "method", display: "method", info: "request method", type: "property" },
    { label: "headers", display: "headers", info: "request headers (HeaderList)", type: "property" },
    { label: "body", display: "body", info: "request body string", type: "property" },
  ],
};

const KP_TOP: Entry[] = [
  { label: "response", display: "response", info: "the response under test", type: "class" },
  { label: "request", display: "request", info: "the resolved request that was sent", type: "class" },
  { label: "variables", display: "variables", info: "request-scope variables", type: "class" },
  { label: "environment", display: "environment", info: "environment variables", type: "class" },
  { label: "collectionVariables", display: "collectionVariables", info: "collection variables", type: "class" },
  { label: "globals", display: "globals", info: "global variables", type: "class" },
  { label: "test", display: "test(name, fn)", info: "record a named test", type: "function", apply: 'test("name", () => {\n  \n});' },
  { label: "expect", display: "expect(value)", info: "assertion entry (chai-style)", type: "function", apply: "expect(" },
];

const PM_TOP: Entry[] = [
  { label: "response", display: "response", info: "the response under test", type: "class" },
  { label: "request", display: "request", info: "the resolved request that was sent", type: "class" },
  { label: "test", display: "test(name, fn)", info: "record a named test", type: "function", apply: 'test("name", () => {\n  \n});' },
  { label: "expect", display: "expect(value)", info: "chai assertion entry", type: "function", apply: "expect(" },
  { label: "environment", display: "environment", info: "environment variables", type: "class" },
  { label: "collectionVariables", display: "collectionVariables", info: "collection variables", type: "class" },
  { label: "variables", display: "variables", info: "request-scope variables", type: "class" },
];

const BRU_TOP: Entry[] = [
  { label: "getVar", display: "getVar(key)", info: "request variable", type: "function", apply: 'getVar("key")' },
  { label: "setVar", display: "setVar(key, value)", info: "request variable", type: "function", apply: 'setVar("key", "value")' },
  { label: "getEnvVar", display: "getEnvVar(key)", info: "environment variable", type: "function", apply: 'getEnvVar("key")' },
  { label: "setEnvVar", display: "setEnvVar(key, value)", info: "environment variable", type: "function", apply: 'setEnvVar("key", "value")' },
  { label: "getCollectionVar", display: "getCollectionVar(key)", info: "collection variable", type: "function", apply: 'getCollectionVar("key")' },
  { label: "setCollectionVar", display: "setCollectionVar(key, value)", info: "collection variable", type: "function", apply: 'setCollectionVar("key", "value")' },
  { label: "sleep", display: "sleep(ms)", info: "pause the script", type: "function", apply: "sleep(1000)" },
];

const GLOBALS: Entry[] = [
  { label: "kp", display: "kp", info: "KnockPort script API", type: "class" },
  { label: "pm", display: "pm", info: "Postman-compatible API", type: "class" },
  { label: "bru", display: "bru", info: "Bruno-compatible API", type: "class" },
  { label: "chai", display: "chai", info: "full chai assertion library (chai.expect)", type: "class" },
];

function topFor(ns: string): Entry[] {
  if (ns === "kp") return KP_TOP;
  if (ns === "pm") return PM_TOP;
  if (ns === "bru") return BRU_TOP;
  return [];
}

function groupMembers(ns: string, member: string): Entry[] {
  // bru exposes flat variable helpers only — no nested member groups
  if (ns === "bru") return [];
  return (KP_ROOT as Record<string, Entry[]>)[member] ?? [];
}

function toCompletions(entries: Entry[]): CompletionResult["options"] {
  return entries.map((e) => ({
    label: e.label,
    displayLabel: e.display,
    info: e.info,
    type: e.type,
    apply: e.apply,
  }));
}

function kpCompletions(context: CompletionContext): CompletionResult | null {
  // Member access on a known group: kp.response.<tab>
  const deep = context.matchBefore(/(kp|pm|bru)\.(\w+)\.\w*$/);
  if (deep) {
    const m = /^(kp|pm|bru)\.(\w+)\.\w*$/.exec(deep.text);
    if (m) {
      const ns = m[1];
      const member = m[2];
      const members = groupMembers(ns, member);
      if (members.length) {
        return {
          from: deep.from + ns.length + 1 + member.length + 1,
          options: toCompletions(members),
          validFor: /^\w*$/,
        };
      }
    }
  }

  // First-level member: kp.<tab>
  const root = context.matchBefore(/(kp|pm|bru)\.\w*$/);
  if (root) {
    const m = /^(kp|pm|bru)\.\w*$/.exec(root.text);
    if (m) {
      const ns = m[1];
      return {
        from: root.from + ns.length + 1,
        options: toCompletions(topFor(ns)),
        validFor: /^\w*$/,
      };
    }
  }

  // Global identifiers (kp, pm, bru, chai)
  const word = context.matchBefore(/\w+$/);
  if (!word && !context.explicit) return null;
  return {
    from: word ? word.from : context.pos,
    options: toCompletions(GLOBALS),
    validFor: /^\w*$/,
  };
}

/** CodeMirror extension that adds kp/pm/bru + standard JS completions. */
export function scriptCompletions() {
  return autocompletion({ override: [kpCompletions, jsCompletions] });
}

/** Test hook: raw completion provider (normally only used via autocompletion). */
export const __kpCompletions = kpCompletions;
