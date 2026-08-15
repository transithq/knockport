import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

// `Tree` lives in @lezer/common (transitive dep) — alias the return type
// instead of importing from a package we don't depend on directly.
type SyntaxTreeLike = ReturnType<typeof syntaxTree>;

// The lezer JavaScript grammar marks every parse-failure position with a
// (usually zero-width) node named "⚠". The node carries no context, so we
// infer a useful message from the surrounding text.
const ERROR_NODE = "\u26A0";

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const OPENERS = new Set(Object.keys(CLOSERS));
const CLOSER_SET = new Set(Object.values(CLOSERS));

/** Track unclosed brackets from 0..upto, skipping strings and comments. */
function bracketStackAt(text: string, upto: number): string[] {
  const stack: string[] = [];
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  let i = 0;
  while (i < Math.min(upto, text.length)) {
    const c = text[i];
    const n = text[i + 1];
    switch (mode) {
      case "line":
        if (c === "\n") mode = "code";
        break;
      case "block":
        if (c === "*" && n === "/") {
          mode = "code";
          i++;
        }
        break;
      case "'":
      case '"':
        if (c === "\\") i++;
        else if (c === mode) mode = "code";
        break;
      case "`":
        if (c === "\\") i++;
        else if (c === "`") mode = "code";
        break;
      default:
        if (c === "/" && n === "/") {
          mode = "line";
          i++;
        } else if (c === "/" && n === "*") {
          mode = "block";
          i++;
        } else if (c === "'" || c === '"' || c === "`") {
          mode = c as "'" | '"' | "`";
        } else if (OPENERS.has(c)) {
          stack.push(CLOSERS[c]);
        } else if (CLOSER_SET.has(c)) {
          if (stack[stack.length - 1] === c) stack.pop();
        }
    }
    i++;
  }
  if (mode === "'" || mode === '"') stack.push("end of string");
  else if (mode === "`") stack.push("end of template string");
  return stack;
}

function messageFor(text: string, from: number): string {
  const stack = bracketStackAt(text, from);
  const top = stack[stack.length - 1];
  if (top)
    return top.startsWith("end of ")
      ? `Unterminated ${top.slice(7)} — add the closing delimiter.`
      : `Expecting '${top}' here.`;
  return "Syntax error.";
}

function mergeAdjacent(errs: Diagnostic[]): Diagnostic[] {
  const sorted = [...errs].sort((a, b) => a.from - b.from);
  const merged: Diagnostic[] = [];
  for (const err of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && err.from <= prev.to && prev.message === err.message) {
      prev.to = Math.max(prev.to, err.to);
    } else {
      merged.push({ ...err });
    }
  }
  return merged;
}

/** Pure lint walk: every lezer error node in `tree` becomes a diagnostic. */
export function lintSyntaxTree(tree: SyntaxTreeLike, doc: Text): Diagnostic[] {
  const text = doc.toString();
  const errs: Diagnostic[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== ERROR_NODE) return;
      errs.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        severity: "error",
        message: messageFor(text, node.from),
      });
    },
  });
  return mergeAdjacent(errs);
}

/** Lint source for @codemirror/lint: reports JS syntax errors inline. */
export function scriptSyntaxLinter(view: EditorView): Diagnostic[] {
  return lintSyntaxTree(syntaxTree(view.state), view.state.doc);
}

/**
 * CodeMirror extension that surfaces JS syntax errors in script editors.
 * (The gutter marker column comes from `basicSetup`'s lintGutter.)
 */
export function scriptLinter() {
  return linter(scriptSyntaxLinter, { delay: 300 });
}
