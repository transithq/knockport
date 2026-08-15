import type { Collection, Folder, Request } from "@knockport/core";

// ── Flattened row model for the virtualized sidebar tree ─────────────────────
export type TreeRow =
  | { kind: "collection"; id: string; collection: Collection }
  | { kind: "folder"; id: string; folder: Folder; collectionId: string; depth: number }
  | { kind: "request"; id: string; request: Request; collectionId: string; depth: number };

/**
 * Walk the collection forest depth-first into a flat row list, skipping the
 * children of collapsed nodes. Collapse state is tracked by node ID.
 */
export function flattenTree(collections: Collection[], collapsed: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];

  const pushFolder = (f: Folder, collectionId: string, depth: number) => {
    rows.push({ kind: "folder", id: f.id, folder: f, collectionId, depth });
    if (!collapsed.has(f.id)) {
      for (const sub of f.folders) pushFolder(sub, collectionId, depth + 1);
      for (const r of f.requests) {
        rows.push({ kind: "request", id: r.id, request: r, collectionId, depth: depth + 1 });
      }
    }
  };

  for (const c of collections) {
    rows.push({ kind: "collection", id: c.id, collection: c });
    if (!collapsed.has(c.id)) {
      for (const f of c.folders) pushFolder(f, c.id, 1);
      for (const r of c.requests) {
        rows.push({ kind: "request", id: r.id, request: r, collectionId: c.id, depth: 1 });
      }
    }
  }
  return rows;
}

export function countRequests(collection: Collection): number {
  const countFolder = (f: Folder): number =>
    f.requests.length + f.folders.reduce((acc, x) => acc + countFolder(x), 0);
  return collection.requests.length + collection.folders.reduce((acc, f) => acc + countFolder(f), 0);
}
