import { useAppStore } from "./app-store";

/**
 * Prompt for the given variable names and await the user's answers (A5).
 * Resolves `{}` when there is nothing to ask, `null` when the dialog was
 * cancelled (send/run aborts).
 */
export function promptForVariables(names: string[]): Promise<Record<string, string> | null> {
  if (names.length === 0) return Promise.resolve({});
  return new Promise((resolve) => {
    useAppStore.getState().setPromptVars({ names, resolve });
  });
}
