import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";

// Standard JavaScript surface: keywords + browser globals the script host
// actually exposes (console, JSON, …). Offered only outside kp.*/pm.*/bru.*
// chains so API member completions never fight the generic lists.

const KEYWORDS: string[] = [
  "const",
  "let",
  "var",
  "function",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "typeof",
  "instanceof",
  "in",
  "of",
  "async",
  "await",
  "class",
  "extends",
  "import",
  "export",
  "default",
  "delete",
];

const GLOBALS: string[] = [
  "console",
  "JSON",
  "Math",
  "Date",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "RegExp",
  "Promise",
  "Map",
  "Set",
  "Symbol",
  "Error",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "atob",
  "btoa",
  "URL",
  "Headers",
];

const keywordOptions: Completion[] = KEYWORDS.map((k) => ({ label: k, type: "keyword" }));
const globalOptions: Completion[] = GLOBALS.map((g) => ({ label: g, type: "class" }));

const snippetOptions: Completion[] = [
  snippetCompletion("console.log(${args});", {
    label: "console.log",
    type: "function",
    info: "Log to the browser console",
  }),
  snippetCompletion("const ${name} = kp.response.json();", {
    label: "response.json",
    type: "function",
    info: "Parse the response body as JSON",
  }),
  snippetCompletion('kp.test("${name}", () => {\n\t${}\n});', {
    label: "kp.test",
    type: "function",
    info: "Record a named test",
  }),
];

/** Chains owned by the script-API source — never compete there. */
const API_CHAIN = /^(kp|pm|bru|chai|response)\./;

/**
 * Generic JS completions: keywords, browser globals, and script snippets.
 * Member access on untracked objects offers globals only when explicitly
 * triggered (Ctrl+Space); API chains stay with kpCompletions.
 */
export function jsCompletions(context: CompletionContext): CompletionResult | null {
  const chain = context.matchBefore(/[\w$]+\.[\w$]*$/);
  const word = context.matchBefore(/[\w$]+$/);

  if (chain) {
    if (API_CHAIN.test(chain.text)) return null;
    if (!context.explicit) return null;
    // Members can't be keywords/snippets — globals only.
    return { from: word ? word.from : context.pos, options: globalOptions, validFor: /^[\w$]*$/ };
  }

  if (!word && !context.explicit) return null;
  // {{var}} placeholders are substituted at runtime, not JS identifiers.
  if (word && word.from >= 2 && context.state.doc.sliceString(word.from - 2, word.from) === "{{")
    return null;

  return {
    from: word ? word.from : context.pos,
    options: [...keywordOptions, ...globalOptions, ...snippetOptions],
    validFor: /^[\w$]*$/,
  };
}

/** Test hook — same provider the autocompletion override chain uses. */
export const __jsCompletions = jsCompletions;
