import { describe, expect, it } from "vitest";
import { generateInterface, interfaceLanguages } from "./index";

const SAMPLE = JSON.stringify({
  id: 1,
  name: "Ada",
  tags: ["math", "compiler"],
  meta: { active: true, score: 9.5 },
  items: [
    { sku: "A1", qty: 2 },
    { sku: "B2", qty: 1 },
  ],
});

describe("response interface codegen (F3)", () => {
  it("offers the Hoppscotch 22-language matrix", () => {
    expect(interfaceLanguages.TypeScript).toBe("typescript");
    expect(interfaceLanguages.Go).toBe("go");
    expect(interfaceLanguages.Python).toBe("python");
    expect(interfaceLanguages["C#"]).toBe("csharp");
    expect(Object.keys(interfaceLanguages)).toHaveLength(22);
  });

  it("generates a TypeScript interface with just-types", async () => {
    const out = await generateInterface("typescript", SAMPLE);
    expect(out).toContain("interface");
    expect(out).toMatch(/id:/);
    expect(out).toMatch(/name:/);
    expect(out).toMatch(/items/);
    expect(out).not.toContain("export const");
  });

  it("generates a Go struct with json tags", async () => {
    const out = await generateInterface("go", SAMPLE);
    expect(out).toContain("type");
    expect(out).toMatch(/json:"id"/);
    expect(out).toMatch(/json:"items"/);
  });

  it("does not throw on a non-JSON body (falls back to {})", async () => {
    const out = await generateInterface("typescript", "<html>not json</html>");
    expect(out.length).toBeGreaterThan(0);
  });
});