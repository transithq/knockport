import { InputData, jsonInputForTargetLanguage, quicktype } from "quicktype-core";

// ── Response data-schema codegen (F3) ────────────────────────────────────────
// Faithful port of Hoppscotch's `json-to-language.ts` + `interfaceLanguages.ts`
// (H§6 `ResponseInterface.vue`): quicktype-core with `just-types: true` over
// the raw response body. Same 22-language matrix as Hoppscotch.

export const interfaceLanguages = {
  cJSON: "cjson",
  "C++": "cpp",
  "C#": "csharp",
  Crystal: "crystal",
  Dart: "dart",
  Elm: "elm",
  Flow: "flow",
  Go: "go",
  Haskell: "haskell",
  Java: "java",
  JavaScript: "javascript",
  Kotlin: "kotlin",
  "Objective-C": "objective-c",
  PHP: "php",
  Pike: "pike",
  Python: "python",
  Ruby: "ruby",
  Rust: "rust",
  Scala3: "scala3",
  Smithy: "smithy4a",
  Swift: "swift",
  TypeScript: "typescript",
} as const;

export type InterfaceLanguageKey = keyof typeof interfaceLanguages;
export type InterfaceLanguage = (typeof interfaceLanguages)[InterfaceLanguageKey];

/**
 * Generate a typed interface/struct for a JSON response body in the given
 * target language (quicktype target ids, e.g. "typescript", "go", "csharp").
 * Mirrors Hoppscotch: an empty object is used when the body is unusable so the
 * call never throws on malformed input.
 */
export async function generateInterface(
  targetLanguage: InterfaceLanguage,
  jsonBody: string
): Promise<string> {
  // quicktype requires valid JSON samples — fall back to an empty object for
  // non-JSON bodies (mirrors Hoppscotch's `response || "{}"` guard).
  let sample = jsonBody;
  try {
    JSON.parse(sample);
  } catch {
    sample = "{}";
  }
  const jsonInput = jsonInputForTargetLanguage(targetLanguage);
  await jsonInput.addSource({
    name: "JSONSchema",
    samples: [sample],
  });
  const inputData = new InputData();
  inputData.addInput(jsonInput);
  const result = await quicktype({
    inputData,
    lang: targetLanguage,
    rendererOptions: {
      "just-types": true,
    },
  });
  return result.lines.join("\n");
}