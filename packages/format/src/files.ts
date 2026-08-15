import type { Collection, Environment, Folder, Request } from "@knockport/core";
import { parse, stringify } from "yaml";
import { collectionFromRaw, requestFromRaw, environmentFromRaw } from "./yaml";

// ── On-disk collection directory format (architecture doc §5) ───────────────
// my-api/
// ├─ knockport.yaml              name, collection auth + scripts + vars, order
// ├─ environments/{dev,prod}.yaml
// └─ requests/
//    ├─ folder.yaml              folder auth + scripts + explicit order
//    └─ auth/{folder.yaml, login.yaml, refresh.yaml}
//
// Rules: byte-stable output (LF, no trailing whitespace, stable key order),
// ordering lives in folder.yaml as an order list, IDs are persisted in the
// files (never regenerated on save).

const STR_OPTS = { lineWidth: 0, minContentWidth: 0, singleQuote: false };

function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/, "\n");
}

function toYaml(doc: unknown): string {
  return normalize(stringify(doc, STR_OPTS));
}

const isYamlFile = (p: string) => /\.(yaml|yml)$/.test(p);

function safeName(name: string, used: Set<string>): string {
  let stem =
    name
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/\.+$/, "") || "unnamed";
  if (used.has(stem.toLowerCase())) {
    let i = 2;
    while (used.has(`${stem.toLowerCase()}-${i}`)) i++;
    stem = `${stem}-${i}`;
  }
  used.add(stem.toLowerCase());
  return stem;
}

// ── Write side ────────────────────────────────────────────────────────────────
function requestDoc(r: Request): Record<string, any> {
  return {
    id: r.id,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: r.headers.length ? r.headers : undefined,
    params: r.params.length ? r.params : undefined,
    body: r.body.type !== "none" ? r.body : undefined,
    auth: r.auth?.type !== "inherit" ? r.auth : undefined,
    scripts: r.scripts,
    assertions: r.assertions?.length ? r.assertions : undefined,
    load: r.load,
  };
}

function folderDoc(f: Folder): Record<string, any> {
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    auth: f.auth,
    scripts: f.scripts,
    order: f.order,
  };
}

function collectionDoc(c: Collection): Record<string, any> {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    auth: c.auth,
    scripts: c.scripts,
    variables: c.variables,
    order: c.order,
  };
}

/**
 * Serialize a collection into the multi-file directory layout.
 * Keys are forward-slash paths relative to the collection root.
 * Deterministic: children are written in order-list order (folders before
 * requests), so repeated writes of unchanged data produce identical file sets.
 */
export function collectionToFiles(c: Collection): Record<string, string> {
  const files: Record<string, string> = {};
  files["knockport.yaml"] = toYaml(collectionDoc(c));

  const orderedChildren = (
    order: string[],
    folders: Folder[],
    requests: Request[],
  ): { folders: Folder[]; requests: Request[] } => {
    const folderIds = new Set(folders.map((f) => f.id));
    const orderedFolders: Folder[] = [];
    const orderedRequests: Request[] = [];
    const takenFolders = new Set<string>();
    const takenRequests = new Set<string>();
    for (const id of order) {
      const f = folders.find((x) => x.id === id);
      if (f) {
        orderedFolders.push(f);
        takenFolders.add(id);
        continue;
      }
      const r = requests.find((x) => x.id === id);
      if (r) {
        orderedRequests.push(r);
        takenRequests.add(id);
      }
      void folderIds;
    }
    for (const f of folders) if (!takenFolders.has(f.id)) orderedFolders.push(f);
    for (const r of requests) if (!takenRequests.has(r.id)) orderedRequests.push(r);
    return { folders: orderedFolders, requests: orderedRequests };
  };

  const writeFolder = (f: Folder, dir: string) => {
    files[`${dir}/folder.yaml`] = toYaml(folderDoc(f));
    const { folders, requests } = orderedChildren(f.order, f.folders, f.requests);
    const childNames = new Set<string>(["folder"]);
    for (const sub of folders) writeFolder(sub, `${dir}/${safeName(sub.name, childNames)}`);
    for (const r of requests) {
      files[`${dir}/${safeName(r.name, childNames)}.yaml`] = toYaml(requestDoc(r));
    }
  };

  const rootNames = new Set<string>();
  const root = orderedChildren(c.order, c.folders, c.requests);
  for (const f of root.folders) writeFolder(f, `requests/${safeName(f.name, rootNames)}`);
  for (const r of root.requests) {
    files[`requests/${safeName(r.name, rootNames)}.yaml`] = toYaml(requestDoc(r));
  }
  return files;
}

/** Serialize environments into the `environments/` subdirectory layout. */
export function environmentsToFiles(envs: Environment[]): Record<string, string> {
  const files: Record<string, string> = {};
  const used = new Set<string>();
  for (const env of envs) {
    files[`environments/${safeName(env.name, used)}.yaml`] = toYaml({
      id: env.id,
      name: env.name,
      variables: env.variables,
      isDefault: env.isDefault,
    });
  }
  return files;
}

// ── Read side ─────────────────────────────────────────────────────────────────
/**
 * Assemble a Collection from the raw files of a collection directory.
 * `files` maps forward-slash relative paths → file contents.
 * The root directory containing `knockport.yaml` is auto-detected.
 */
export function filesToCollection(files: Record<string, string>): Collection {
  const rootKey = Object.keys(files).find((p) => p === "knockport.yaml" || p.endsWith("/knockport.yaml"));
  if (!rootKey) throw new Error("No knockport.yaml found — not a KnockPort collection folder");

  const base = rootKey === "knockport.yaml" ? "" : rootKey.slice(0, rootKey.length - "knockport.yaml".length);
  const meta = parse(files[rootKey]) as any;

  const collection = collectionFromRaw({ ...(meta ?? {}), folders: [], requests: [] });

  // Directory entries are implicit — derive the first-level path segments
  // under a prefix (files only exist as leaves of the tree).
  const directChildren = (dir: string): string[] => {
    const segments = new Set<string>();
    for (const p of Object.keys(files)) {
      if (p.startsWith(dir)) segments.add(p.slice(dir.length).split("/")[0]);
    }
    return [...segments].sort().map((s) => dir + s);
  };

  const readFolder = (dir: string, fallbackName: string): Folder => {
    const metaPath = `${dir}/folder.yaml`;
    const doc = files[metaPath] !== undefined ? (parse(files[metaPath]) as any) : null;
    const folder: Folder = {
      id: doc?.id ?? "",
      name: doc?.name ?? fallbackName,
      description: doc?.description,
      auth: doc?.auth,
      scripts: doc?.scripts,
      folders: [],
      requests: [],
      order: doc?.order ?? [],
    };
    for (const path of directChildren(`${dir}/`)) {
      if (path === metaPath) continue;
      const fileName = path.slice(dir.length + 1);
      if (Object.keys(files).some((p) => p.startsWith(`${path}/`))) {
        folder.folders.push(readFolder(path, fileName.replace(/-/g, " ")));
      } else if (isYamlFile(path)) {
        const parsed = parse(files[path]);
        if (parsed && typeof parsed === "object") folder.requests.push(requestFromRaw(parsed));
      }
    }
    if (folder.order.length === 0) {
      folder.order = [...folder.folders.map((x) => x.id), ...folder.requests.map((r) => r.id)];
    }
    return folder;
  };

  const requestsPrefix = `${base}requests/`;
  for (const path of directChildren(requestsPrefix)) {
    const fileName = path.slice(requestsPrefix.length);
    if (isYamlFile(path)) {
      const parsed = parse(files[path]);
      if (parsed && typeof parsed === "object") collection.requests.push(requestFromRaw(parsed));
    } else if (Object.keys(files).some((p) => p.startsWith(`${path}/`))) {
      collection.folders.push(readFolder(path, fileName.replace(/-/g, " ")));
    }
  }

  if (collection.order.length === 0) {
    collection.order = [...collection.folders.map((f) => f.id), ...collection.requests.map((r) => r.id)];
  }
  return collection;
}

/** Assemble environments from the `environments/` directory entries. */
export function filesToEnvironments(files: Record<string, string>): Environment[] {
  const envs: Environment[] = [];
  for (const [path, content] of Object.entries(files)) {
    const norm = path.replace(/\\/g, "/");
    if (!/environments\/[^/]+\.(yaml|yml)$/.test(norm)) continue;
    const doc = parse(content);
    if (!doc || typeof doc !== "object") continue;
    envs.push(environmentFromRaw(doc));
  }
  return envs;
}
