import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

// Extract the source source of the completion fn indirectly by importing the
// module internals through a small re-export is not possible, so test the
// behavior via a lightweight context built on a real EditorState.
import { scriptCompletions } from "./script-completions";

function ctx(doc: string, pos = doc.length, explicit = true): CompletionContext {
  const state = EditorState.create({ doc, extensions: [scriptCompletions()] });
  return new CompletionContext(state, pos, explicit);
}

// The override fn is installed via scriptCompletions(); reach it through the
// extension's internal config (single source). Simpler: re-create the same
// regex-driven behavior by invoking the provider that autocompletion uses.
// We import the provider via a dedicated export in the module below.
import { __kpCompletions as kpCompletions } from "./script-completions";

describe("kp completions", () => {
  it("offers namespace members after kp.", () => {
    const result = kpCompletions(ctx("kp."));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("response");
    expect(labels).toContain("test");
    expect(labels).toContain("collectionVariables");
  });

  it("offers response members after kp.response.", () => {
    const result = kpCompletions(ctx("kp.response."));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("code");
    expect(labels).toContain("json");
    expect(labels).toContain("responseTime");
  });

  it("filters member matches mid-word", () => {
    const result = kpCompletions(ctx("kp.re"));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("response");
  });

  it("offers bru variable helpers only", () => {
    const result = kpCompletions(ctx("bru."));
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("setVar");
    expect(labels).toContain("getEnvVar");
    // bru has no nested member groups — never offers kp member groups
    const deep = kpCompletions(ctx("bru.setVar."));
    expect(deep?.options.map((o) => o.label)).not.toContain("code");
  });

  it("offers bru.utils and bru.cookies member groups (C9/C8)", () => {
    const utils = kpCompletions(ctx("bru.utils."));
    expect(utils!.options.map((o) => o.label)).toContain("minifyJson");
    const cookies = kpCompletions(ctx("bru.cookies."));
    const labels = cookies!.options.map((o) => o.label);
    expect(labels).toContain("get");
    expect(labels).toContain("upsert");
    expect(labels).toContain("jar");
  });

  it("offers the chai global", () => {
    const result = kpCompletions(ctx("ch"));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("chai");
  });
});
