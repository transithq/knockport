import type { Collection } from "@knockport/core";
import { FileSystemAdapter } from "@knockport/storage";
import { collectionToFiles, filesToCollection } from "@knockport/format";
import { useAppStore } from "./app-store";

// ── Disk-backed collections (File System Access) ─────────────────────────────
// Opening a folder imports its collection; while the app runs, the folder
// handle stays in memory and every change to that collection is written back
// as YAML (byte-stable, architecture doc §5). Handles are session-only —
// re-open the folder next time.

/** Per-collection adapter bound to the chosen folder (session only). */
const adapters = new Map<string, FileSystemAdapter>();
/** Pending write timers keyed by collection ID (debounced write-back). */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function isDiskCollection(collectionId: string): boolean {
  return adapters.has(collectionId);
}

export function releaseDiskCollection(collectionId: string): void {
  adapters.delete(collectionId);
  useAppStore.getState().setDiskRoot(collectionId, null);
}

/**
 * Prompt for a directory, read its YAML tree, and import the collection.
 * Returns the imported collection, or null when the picker was cancelled or
 * the folder is not a KnockPort collection.
 */
export async function openCollectionFolder(): Promise<{ collection?: Collection; error?: string }> {
  const support = (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
  if (typeof support !== "function") {
    return { error: "This browser does not support opening folders (File System Access API)." };
  }

  const adapter = new FileSystemAdapter();
  const opened = await adapter.openDirectory();
  if (!opened) return {}; // cancelled

  const files = await adapter.readAllYaml();
  let collection: Collection;
  try {
    collection = filesToCollection(files);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid collection folder" };
  }

  const store = useAppStore.getState();
  if (store.collections.some((c) => c.id === collection.id)) {
    // Re-opening a previously loaded folder — replace in place.
    store.updateCollection(collection.id, collection);
  } else {
    store.addCollection(collection);
  }

  adapters.set(collection.id, adapter);
  store.setDiskRoot(collection.id, adapter.rootName() ?? "folder");
  store.setSidebarTab("collections");
  return { collection };
}

/** Write the full collection back to its folder (all YAML files). */
export async function writeCollectionToDisk(collection: Collection): Promise<boolean> {
  const adapter = adapters.get(collection.id);
  if (!adapter) return false;

  const files = collectionToFiles(collection);
  const existing = await adapter.readAllYaml();

  // Remove stale YAML leaves that are no longer part of the collection.
  for (const path of Object.keys(existing)) {
    const norm = path.replace(/\\/g, "/");
    if (!(norm in files)) await adapter.removeEntry(norm);
  }
  for (const [path, content] of Object.entries(files)) {
    const ok = await adapter.writeFile(path, content);
    if (!ok) return false;
  }
  return true;
}

/** Schedule a debounced write-back for a disk-backed collection. */
export function scheduleDiskWrite(collectionId: string): void {
  if (!adapters.has(collectionId)) return;
  const prev = pending.get(collectionId);
  if (prev) clearTimeout(prev);
  pending.set(
    collectionId,
    setTimeout(() => {
      pending.delete(collectionId);
      const collection = useAppStore.getState().collections.find((c) => c.id === collectionId);
      if (collection) writeCollectionToDisk(collection).catch(() => {});
    }, 400),
  );
}

/**
 * Subscribe to store changes: any update to a disk-backed collection is
 * written back to disk (debounced). Installed once at app startup.
 */
let installed = false;
export function installDiskSync(): void {
  if (installed) return;
  installed = true;

  let prevCollections = useAppStore.getState().collections;
  useAppStore.subscribe((state) => {
    if (state.collections === prevCollections) return;
    const prev = prevCollections;
    prevCollections = state.collections;
    for (const c of state.collections) {
      if (!adapters.has(c.id)) continue;
      if (c !== prev.find((p) => p.id === c.id)) scheduleDiskWrite(c.id);
    }
    // Drop adapters for collections that were deleted while disk-backed
    for (const id of [...adapters.keys()]) {
      if (!state.collections.some((c) => c.id === id)) adapters.delete(id);
    }
  });
}
