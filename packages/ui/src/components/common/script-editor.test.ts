import { CompletionContext } from "@codemirror/autocomplete";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { scriptCompletions } from "./script-completions";
import { lintSyntaxTree } from "./script-lint";
import { __jsCompletions as jsCompletions } from "./script-snippets";

function ctx(doc: string, pos = doc.length, explicit = true): CompletionContext {
  const state = EditorState.create({ doc, extensions: [scriptCompletions()] });
  return new CompletionContext(state, pos, explicit);
}

function lint(doc: string) {
  const text = Text.of(doc.split("\n"));
  const tree = javascriptLanguage.parser.parse(doc);
  return lintSyntaxTree(tree, text);
}

describe("standard JS completions", () => {
  it("offers keywords and globals at top level", () => {
    const result = jsCompletions(ctx("con"));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("const");
    expect(labels).toContain("console");
    expect(labels).toContain("console.log");
  });

  it("stays silent on unknown member chains unless explicit", () => {
    expect(jsCompletions(ctx("foo.", 4, false))).toBeNull();
  });

  it("never competes with kp/pm/bru chains", () => {
    expect(jsCompletions(ctx("kp."))).toBeNull();
    expect(jsCompletions(ctx("bru."))).toBeNull();
    expect(jsCompletions(ctx("chai."))).toBeNull();
  });

  it("offers globals on explicit chain completion", () => {
    const result = jsCompletions(ctx("foo.J"), 5, true);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("JSON");
  });

  it("skips {{variable}} placeholders", () => {
    const state = EditorState.create({
      doc: "const url = {{base}}",
      extensions: [scriptCompletions()],
    });
    const c = new CompletionContext(state, 17, true); // inside {{base
    expect(jsCompletions(c)).toBeNull();
  });
});

describe("script syntax linting", () => {
  it("reports nothing for valid scripts", () => {
    expect(lint('kp.test("ok", () => { kp.expect(1).to.eql(1); });')).toEqual([]);
    expect(lint("const x = kp.response.json();")).toEqual([]);
  });

  it("flags a missing closing paren with bracket context", () => {
    const diags = lint("kp.test(1");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain(")");
    expect(diags[0].severity).toBe("error");
  });

  it("flags unterminated strings", () => {
    const diags = lint('kp.test("unfinished');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message.toLowerCase()).toContain("string");
  });

  it("flags brace mismatches", () => {
    const diags = lint("const x = {a: ;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
  });
});
