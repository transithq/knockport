import { describe, expect, it } from "vitest";
import { OPERATOR_SNIPPETS, assertionSuggestions } from "./AssertionsEditor";

// C11 — the assertion editor suggestion set keeps KP free-form JS while
// offering Bruno's 28-operator matrix as Tab-completion templates.

describe("assertion operator matrix (C11)", () => {
  it("covers all 28 Bruno operators", () => {
    const hints = OPERATOR_SNIPPETS.map((s) => s.hint ?? "");
    const required = [
      "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains",
      "notContains", "matches", "notMatches", "startsWith", "endsWith",
      "length", "between", "isEmpty", "isNotEmpty", "isNull", "isUndefined",
      "isDefined", "isTruthy", "isFalsy", "isJson", "isNumber", "isString",
      "isBoolean", "isArray",
    ];
    for (const op of required) {
      expect(hints.some((h) => h === op || h.startsWith(op) || h.startsWith(`${op} (`))).toBe(true);
    }
  });

  it("every insert only touches engine response members", () => {
    // The operator set must only use members the engine's __kp_response
    // bridge exposes (status/statusText/headers/body/responseTime/size) or
    // the derived JSON.parse(response.body) value.
    const memberRe = /response\.(status|statusText|headers|body|responseTime|size)\b/;
    for (const s of OPERATOR_SNIPPETS) {
      expect(memberRe.test(s.insert)).toBe(true);
      // No forbidden member access on the response object.
      for (const bad of [".code", ".json(", ".to.", ".ok", ".redirects"]) {
        expect(s.insert).not.toContain(`response${bad}`);
      }
      // No leftover template placeholders.
      expect(s.insert).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("empty field offers the full matrix", () => {
    expect(assertionSuggestions("").length).toBeGreaterThanOrEqual(28);
  });

  it("typing filters by expression prefix", () => {
    const result = assertionSuggestions("response.status");
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) expect(s.insert.startsWith("response.status")).toBe(true);
  });

  it("operator words find their templates via the hint", () => {
    expect(assertionSuggestions("between")[0]?.hint).toBe("between");
    expect(assertionSuggestions("isJson").some((s) => s.hint === "isJson")).toBe(true);
  });

  it("unrelated typing yields no matches", () => {
    expect(assertionSuggestions("zzz-no-match")).toEqual([]);
  });
});
