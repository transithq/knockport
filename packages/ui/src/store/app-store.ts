import type {
  AuthConfig,
  BodyContent,
  Collection,
  Environment,
  Folder,
  HistoryEntry,
  HttpMethod,
  KeyValuePair,
  Request,
  Response,
} from "@knockport/core";
import { createId } from "@knockport/core";
import type { TestRunSummary } from "@knockport/engine";
import {
  collections as dbCollections,
  environments as dbEnvironments,
  history as dbHistory,
} from "@knockport/storage";
import { create } from "zustand";

// ── Tab types ────────────────────────────────────────────────────────────────
export interface RequestTab {
  id: string;
  requestId: string;
  name: string;
  isDirty: boolean;
  kind?: "request" | "environment" | "collection" | "runner" | "settings";
  envId?: string;
  collectionId?: string;
}

export type ActivePanel = "params" | "headers" | "auth" | "body" | "scripts" | "tests" | "settings";
export type ResponsePanel = "pretty" | "raw" | "preview" | "headers" | "timings" | "cookies";
export type SidebarTab = "collections" | "environments" | "history";

// ── Collection runner history (in-memory) ───────────────────────────────────
export interface CollectionRunEntry {
  name: string;
  method: string;
  status: number;
  time: number;
  ok: boolean;
  testsPassed?: number;
  testsTotal?: number;
  error?: string;
  /** Resolved URL that was executed. */
  url?: string;
  /** Full response for inspection in the runner tab. */
  response?: Response | null;
  testSummary?: TestRunSummary | null;
}

export interface CollectionRun {
  id: string;
  collectionId: string;
  startedAt: string;
  iterations: number;
  results: CollectionRunEntry[];
}

// ── Runner tab state (kept in store so the tab survives unmount) ────────────
export interface RunnerTabState {
  phase: "config" | "running" | "done";
  iterations: number;
  delay: number;
  excluded: string[];
  results: CollectionRunEntry[];
  selectedIdx: number | null;
  filter: "all" | "passed" | "failed";
}

export const DEFAULT_RUNNER_STATE: RunnerTabState = {
  phase: "config",
  iterations: 1,
  delay: 0,
  excluded: [],
  results: [],
  selectedIdx: null,
  filter: "all",
};

// ── Folder tree helpers ─────────────────────────────────────────────────────
function makeFolder(name: string): Folder {
  return { id: createId("folder"), name, folders: [], requests: [], order: [] };
}

function insertFolder(folders: Folder[], parentId: string | null, folder: Folder): Folder[] {
  if (parentId === null) return [...folders, folder];
  return folders.map((f) =>
    f.id === parentId
      ? { ...f, folders: [...f.folders, folder] }
      : { ...f, folders: insertFolder(f.folders, parentId, folder) },
  );
}

function mapFolderTree(folders: Folder[], folderId: string, fn: (f: Folder) => Folder): Folder[] {
  return folders.map((f) =>
    f.id === folderId ? fn(f) : { ...f, folders: mapFolderTree(f.folders, folderId, fn) },
  );
}

function removeFolder(folders: Folder[], folderId: string): Folder[] {
  return folders
    .filter((f) => f.id !== folderId)
    .map((f) => ({ ...f, folders: removeFolder(f.folders, folderId) }));
}

function removeRequest(folders: Folder[], requestId: string): Folder[] {
  return folders.map((f) => ({
    ...f,
    requests: f.requests.filter((r) => r.id !== requestId),
    folders: removeRequest(f.folders, requestId),
  }));
}

function containsRequest(folders: Folder[], requestId: string): boolean {
  return folders.some(
    (f) => f.requests.some((r) => r.id === requestId) || containsRequest(f.folders, requestId),
  );
}

function replaceRequestInFolders(folders: Folder[], requestId: string, req: Request): Folder[] {
  return folders.map((f) => ({
    ...f,
    requests: f.requests.map((r) => (r.id === requestId ? req : r)),
    folders: replaceRequestInFolders(f.folders, requestId, req),
  }));
}

function findOwningCollection(
  collections: Collection[],
  requestId: string,
): Collection | undefined {
  return collections.find(
    (c) => c.requests.some((r) => r.id === requestId) || containsRequest(c.folders, requestId),
  );
}

// ── Persistence helpers (fire-and-forget) ───────────────────────────────────
function persistCollection(c: Collection) {
  dbCollections.save(c as any).catch(() => {});
}

function persistEnvironment(e: Environment) {
  dbEnvironments.save(e as any).catch(() => {});
}

// ── App Store ────────────────────────────────────────────────────────────────
export interface AppStore {
  // Sidebar
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  sidebarCollapsed: boolean;

  // Workspace layout (resizable panes, persisted)
  /** Right analytics column width in px. */
  rightPaneWidth: number;
  /** Request pane height in px (response fills the rest). */
  requestPaneHeight: number;

  // Collections
  collections: Collection[];
  activeCollectionId: string | null;
  /** IDs of collapsed sidebar tree nodes (collections + folders). */
  collapsedNodes: string[];
  /** Collection ID → name of the folder it is backed by on disk (session). */
  diskRoots: Record<string, string>;

  // Environments
  environments: Environment[];
  activeEnvironmentId: string | null;

  // Request tabs
  tabs: RequestTab[];
  activeTabId: string | null;

  // Request state (keyed by tab ID)
  requests: Record<string, Request>;
  responses: Record<string, Response | null>;
  testResults: Record<string, TestRunSummary | null>;
  isLoading: Record<string, boolean>;

  // History
  history: HistoryEntry[];

  // Collection runner history (session-only)
  collectionRuns: CollectionRun[];

  // Runner tab state (keyed by collection ID, session-only)
  runnerStates: Record<string, RunnerTabState>;

  // UI
  activeRequestPanel: ActivePanel;
  activeResponsePanel: ResponsePanel;
  commandPaletteOpen: boolean;
  codegenOpen: boolean;
  importOpen: boolean;
  websocketOpen: boolean;
  theme: "dark" | "light";

  // Transport settings (relay)
  useRelay: boolean;
  relayUrl: string;

  // Global request timeout (ms) applied to every send
  timeoutMs: number;

  // Actions — Sidebar
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;

  // Actions — Layout panes
  setRightPaneWidth: (width: number) => void;
  setRequestPaneHeight: (height: number) => void;

  // Actions — Collections
  addCollection: (collection: Collection) => void;
  setActiveCollection: (id: string | null) => void;
  toggleNode: (id: string) => void;
  setDiskRoot: (collectionId: string, rootName: string | null) => void;
  updateCollection: (id: string, changes: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  addFolder: (collectionId: string, parentFolderId: string | null, name: string) => void;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  addRequest: (collectionId: string, folderId: string | null, name?: string) => void;
  deleteRequest: (collectionId: string, requestId: string) => void;
  loadCollections: () => Promise<void>;

  // Actions — Environments
  addEnvironment: (env: Environment) => void;
  setActiveEnvironment: (id: string | null) => void;
  updateEnvironment: (id: string, changes: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  loadEnvironments: () => Promise<void>;

  // Actions — Tabs
  openTab: (request: Request) => void;
  openEnvironmentTab: (envId: string) => void;
  openCollectionTab: (collectionId: string) => void;
  openRunnerTab: (collectionId: string) => void;
  openSettingsTab: () => void;
  closeTab: (tabId: string) => void;
  saveRequestTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;

  // Actions — Request
  updateRequest: (tabId: string, changes: Partial<Request>) => void;
  updateRequestMethod: (tabId: string, method: HttpMethod) => void;
  updateRequestUrl: (tabId: string, url: string) => void;
  updateRequestHeaders: (tabId: string, headers: KeyValuePair[]) => void;
  updateRequestParams: (tabId: string, params: KeyValuePair[]) => void;
  updateRequestBody: (tabId: string, body: BodyContent) => void;
  updateRequestAuth: (tabId: string, auth: AuthConfig) => void;

  // Actions — Response
  setResponse: (tabId: string, response: Response | null) => void;
  setTestResults: (tabId: string, results: TestRunSummary | null) => void;
  setLoading: (tabId: string, loading: boolean) => void;

  // Actions — History
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
  loadHistory: () => Promise<void>;
  recordCollectionRun: (run: CollectionRun) => void;
  setRunnerState: (collectionId: string, patch: Partial<RunnerTabState>) => void;
  clearRunnerState: (collectionId: string) => void;

  // Actions — UI
  setActiveRequestPanel: (panel: ActivePanel) => void;
  setActiveResponsePanel: (panel: ResponsePanel) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setCodegenOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  setWebsocketOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setUseRelay: (on: boolean) => void;
  setRelayUrl: (url: string) => void;
  setTimeoutMs: (ms: number) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // ── Initial State ────────────────────────────────────────────────────────
  sidebarTab: "collections",
  sidebarWidth:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-sidebar-width") ?? "", 10)) ||
    280,
  sidebarCollapsed: false,

  rightPaneWidth:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-right-pane-width") ?? "", 10)) ||
    400,
  requestPaneHeight:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-request-pane-height") ?? "", 10)) ||
    320,

  collections: [],
  activeCollectionId: null,
  collapsedNodes: [],
  diskRoots: {},

  environments: [],
  activeEnvironmentId: null,

  tabs: [],
  activeTabId: null,

  requests: {},
  responses: {},
  testResults: {},
  isLoading: {},

  history: [],

  collectionRuns: [],
  runnerStates: {},

  activeRequestPanel: "params",
  activeResponsePanel: "pretty",
  commandPaletteOpen: false,
  codegenOpen: false,
  importOpen: false,
  websocketOpen: false,
  theme:
    typeof localStorage !== "undefined" && localStorage.getItem("kp-theme") === "light"
      ? "light"
      : "dark",

  useRelay: typeof localStorage !== "undefined" && localStorage.getItem("kp-use-relay") === "1",
  relayUrl:
    (typeof localStorage !== "undefined" && localStorage.getItem("kp-relay-url")) ||
    "http://localhost:8787",

  timeoutMs:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-timeout-ms") ?? "", 10)) ||
    30000,

  // ── Sidebar Actions ──────────────────────────────────────────────────────
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarWidth: (width) => {
    set({ sidebarWidth: width });
    try {
      localStorage.setItem("kp-sidebar-width", String(width));
    } catch {
      /* storage unavailable */
    }
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setRightPaneWidth: (width) => {
    set({ rightPaneWidth: width });
    try {
      localStorage.setItem("kp-right-pane-width", String(width));
    } catch {
      /* storage unavailable */
    }
  },
  setRequestPaneHeight: (height) => {
    set({ requestPaneHeight: height });
    try {
      localStorage.setItem("kp-request-pane-height", String(height));
    } catch {
      /* storage unavailable */
    }
  },

  // ── Collection Actions ───────────────────────────────────────────────────
  addCollection: (collection) => {
    set((s) => ({ collections: [...s.collections, collection] }));
    persistCollection(collection);
  },
  setActiveCollection: (id) => set({ activeCollectionId: id }),
  toggleNode: (id) =>
    set((s) => ({
      collapsedNodes: s.collapsedNodes.includes(id)
        ? s.collapsedNodes.filter((x) => x !== id)
        : [...s.collapsedNodes, id],
    })),
  setDiskRoot: (collectionId, rootName) =>
    set((s) => {
      const diskRoots = { ...s.diskRoots };
      if (rootName === null) delete diskRoots[collectionId];
      else diskRoots[collectionId] = rootName;
      return { diskRoots };
    }),
  updateCollection: (id, changes) => {
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, ...changes } : c)),
      // Keep any open collection tab's title in sync with the name
      tabs: changes.name
        ? s.tabs.map((t) =>
            t.kind === "collection" && t.collectionId === id
              ? { ...t, name: changes.name as string }
              : t,
          )
        : s.tabs,
    }));
    const c = get().collections.find((x) => x.id === id);
    if (c) persistCollection(c);
  },
  deleteCollection: (id) => {
    set((s) => {
      // Close any variables tab pointing at the deleted collection
      const doomed = s.tabs
        .filter((t) => t.kind === "collection" && t.collectionId === id)
        .map((t) => t.id);
      const tabs = doomed.length > 0 ? s.tabs.filter((t) => !doomed.includes(t.id)) : s.tabs;
      let activeTabId = s.activeTabId;
      if (activeTabId && doomed.includes(activeTabId)) activeTabId = tabs[0]?.id ?? null;
      const diskRoots = { ...s.diskRoots };
      delete diskRoots[id];
      return {
        collections: s.collections.filter((c) => c.id !== id),
        activeCollectionId: s.activeCollectionId === id ? null : s.activeCollectionId,
        tabs,
        activeTabId,
        diskRoots,
      };
    });
    dbCollections.delete(id).catch(() => {});
  },

  addFolder: (collectionId, parentFolderId, name) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, folders: insertFolder(c.folders, parentFolderId, makeFolder(name)) }
          : c,
      ),
    }));
    const c = get().collections.find((x) => x.id === collectionId);
    if (c) persistCollection(c);
  },

  renameFolder: (collectionId, folderId, name) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, folders: mapFolderTree(c.folders, folderId, (f) => ({ ...f, name })) }
          : c,
      ),
    }));
    const c = get().collections.find((x) => x.id === collectionId);
    if (c) persistCollection(c);
  },

  deleteFolder: (collectionId, folderId) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, folders: removeFolder(c.folders, folderId) } : c,
      ),
    }));
    const c = get().collections.find((x) => x.id === collectionId);
    if (c) persistCollection(c);
  },

  addRequest: (collectionId, folderId, name = "New Request") => {
    const request: Request = {
      id: createId("req"),
      name,
      method: "GET",
      url: "",
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "inherit" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? folderId
            ? {
                ...c,
                folders: mapFolderTree(c.folders, folderId, (f) => ({
                  ...f,
                  requests: [...f.requests, request],
                })),
              }
            : { ...c, requests: [...c.requests, request] }
          : c,
      ),
    }));
    const c = get().collections.find((x) => x.id === collectionId);
    if (c) persistCollection(c);
    get().openTab(request);
  },

  deleteRequest: (collectionId, requestId) =>
    set((s) => {
      const collections = s.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              folders: removeRequest(c.folders, requestId),
              requests: c.requests.filter((r) => r.id !== requestId),
            }
          : c,
      );
      // Close any tab pointing at the deleted request
      const doomed = s.tabs.filter((t) => t.requestId === requestId).map((t) => t.id);
      let { tabs, activeTabId, requests, responses, isLoading } = s;
      const testResults = { ...s.testResults };
      if (doomed.length > 0) {
        tabs = tabs.filter((t) => t.requestId !== requestId);
        if (activeTabId && doomed.includes(activeTabId)) activeTabId = tabs[0]?.id ?? null;
        requests = { ...requests };
        responses = { ...responses };
        isLoading = { ...isLoading };
        for (const id of doomed) {
          delete requests[id];
          delete responses[id];
          delete testResults[id];
          delete isLoading[id];
        }
      }
      const c = collections.find((x) => x.id === collectionId);
      if (c) persistCollection(c);
      return { collections, tabs, activeTabId, requests, responses, testResults, isLoading };
    }),

  loadCollections: async () => {
    try {
      const records = await dbCollections.getAll();
      // Deprecated: collection-level `scripts.test` (the former Tests column)
      // is folded into `scripts.postResponse` so existing test scripts keep
      // running under the script-only model.
      const collections = (records as unknown as Collection[]).map((c) => {
        const t = c.scripts?.test;
        if (!t?.trim()) return c;
        const migrated: Collection = {
          ...c,
          scripts: {
            ...c.scripts,
            test: undefined,
            postResponse: c.scripts?.postResponse?.trim()
              ? `${c.scripts.postResponse}\n\n${t}`
              : t,
          },
        };
        persistCollection(migrated);
        return migrated;
      });
      set({ collections });
    } catch {
      // storage unavailable
    }
  },

  // ── Environment Actions ──────────────────────────────────────────────────
  addEnvironment: (env) => {
    set((s) => ({ environments: [...s.environments, env] }));
    persistEnvironment(env);
  },
  setActiveEnvironment: (id) => {
    set({ activeEnvironmentId: id });
    try {
      if (id) localStorage.setItem("kp-active-env", id);
      else localStorage.removeItem("kp-active-env");
    } catch {
      // ignore
    }
  },
  updateEnvironment: (id, changes) => {
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? { ...e, ...changes } : e)),
      // Keep any open environment tab's title in sync with the name
      tabs: changes.name
        ? s.tabs.map((t) =>
            t.kind === "environment" && t.envId === id ? { ...t, name: changes.name as string } : t,
          )
        : s.tabs,
    }));
    const e = get().environments.find((x) => x.id === id);
    if (e) persistEnvironment(e);
  },
  deleteEnvironment: (id) => {
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvironmentId: s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
    }));
    dbEnvironments.delete(id).catch(() => {});
  },

  loadEnvironments: async () => {
    try {
      const records = await dbEnvironments.getAll();
      const envs = records as unknown as Environment[];
      let active = localStorage.getItem("kp-active-env");
      if (!active || !envs.some((e) => e.id === active)) active = envs[0]?.id ?? null;
      set({ environments: envs, activeEnvironmentId: active });
    } catch {
      // storage unavailable
    }
  },

  // ── Tab Actions ──────────────────────────────────────────────────────────
  openTab: (request) => {
    const existing = get().tabs.find((t) => t.requestId === request.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    const tab: RequestTab = {
      id: tabId,
      requestId: request.id,
      name: request.name,
      isDirty: false,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tabId,
      requests: { ...s.requests, [tabId]: request },
      responses: { ...s.responses, [tabId]: null },
      testResults: { ...s.testResults, [tabId]: null },
    }));
  },

  closeTab: (tabId) => {
    const prev = get();
    const tab = prev.tabs.find((t) => t.id === tabId);
    // Flush unsaved request edits back into the collection tree before closing
    if (tab && (!tab.kind || tab.kind === "request") && tab.isDirty) {
      const edited = prev.requests[tabId];
      if (edited) {
        const col = findOwningCollection(prev.collections, tab.requestId);
        if (col) {
          const updated: Collection = {
            ...col,
            requests: col.requests.map((r) => (r.id === edited.id ? edited : r)),
            folders: replaceRequestInFolders(col.folders, edited.id, edited),
          };
          set((st) => ({
            collections: st.collections.map((c) => (c.id === col.id ? updated : c)),
          }));
          persistCollection(updated);
        }
      }
    }
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const newTabs = s.tabs.filter((t) => t.id !== tabId);
      let newActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null;
      }
      const newRequests = { ...s.requests };
      const newResponses = { ...s.responses };
      const newTestResults = { ...s.testResults };
      const newLoading = { ...s.isLoading };
      delete newRequests[tabId];
      delete newResponses[tabId];
      delete newTestResults[tabId];
      delete newLoading[tabId];
      // Drop runner-tab session state when the runner tab closes
      let runnerStates = s.runnerStates;
      if (tab?.kind === "runner" && tab.collectionId && runnerStates[tab.collectionId]) {
        runnerStates = { ...runnerStates };
        delete runnerStates[tab.collectionId];
      }
      return {
        tabs: newTabs,
        activeTabId: newActive,
        requests: newRequests,
        responses: newResponses,
        testResults: newTestResults,
        isLoading: newLoading,
        runnerStates,
      };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  // Ctrl+S: flush dirty request-tab edits into the owning collection without
  // closing the tab (shared flush semantics with closeTab).
  saveRequestTab: (tabId) => {
    const prev = get();
    const tab = prev.tabs.find((t) => t.id === tabId);
    if (!tab || (tab.kind && tab.kind !== "request")) return;
    const edited = prev.requests[tabId];
    if (!edited || !tab.isDirty) return;
    const col = findOwningCollection(prev.collections, tab.requestId);
    if (col) {
      const updated: Collection = {
        ...col,
        requests: col.requests.map((r) => (r.id === edited.id ? edited : r)),
        folders: replaceRequestInFolders(col.folders, edited.id, edited),
      };
      set((st) => ({
        collections: st.collections.map((c) => (c.id === col.id ? updated : c)),
        tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
      }));
      persistCollection(updated);
    } else {
      // Standalone request not owned by any collection — just clear the flag
      set((st) => ({
        tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
      }));
    }
  },

  openEnvironmentTab: (envId) => {
    const s = get();
    const env = s.environments.find((e) => e.id === envId);
    if (!env) return;
    const existing = s.tabs.find((t) => t.kind === "environment" && t.envId === envId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [
        ...st.tabs,
        {
          id: tabId,
          requestId: `env:${envId}`,
          envId,
          kind: "environment",
          name: env.name,
          isDirty: false,
        },
      ],
      activeTabId: tabId,
    }));
  },

  openCollectionTab: (collectionId) => {
    const s = get();
    const col = s.collections.find((c) => c.id === collectionId);
    if (!col) return;
    const existing = s.tabs.find((t) => t.kind === "collection" && t.collectionId === collectionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [
        ...st.tabs,
        {
          id: tabId,
          requestId: `col:${collectionId}`,
          collectionId,
          kind: "collection",
          name: col.name,
          isDirty: false,
        },
      ],
      activeTabId: tabId,
    }));
  },

  openRunnerTab: (collectionId) => {
    const s = get();
    const col = s.collections.find((c) => c.id === collectionId);
    if (!col) return;
    const existing = s.tabs.find((t) => t.kind === "runner" && t.collectionId === collectionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [
        ...st.tabs,
        {
          id: tabId,
          requestId: `run:${collectionId}`,
          collectionId,
          kind: "runner",
          name: `▶ ${col.name}`,
          isDirty: false,
        },
      ],
      activeTabId: tabId,
    }));
  },

  openSettingsTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "settings");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [
        ...st.tabs,
        { id: tabId, requestId: "settings", kind: "settings", name: "Settings", isDirty: false },
      ],
      activeTabId: tabId,
    }));
  },

  // ── Request Actions ──────────────────────────────────────────────────────
  updateRequest: (tabId, changes) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], ...changes },
      },
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: true, name: changes.name ?? t.name } : t,
      ),
    })),

  updateRequestMethod: (tabId, method) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], method },
      },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: true } : t)),
    })),

  updateRequestUrl: (tabId, url) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], url },
      },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: true } : t)),
    })),

  updateRequestHeaders: (tabId, headers) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], headers },
      },
    })),

  updateRequestParams: (tabId, params) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], params },
      },
    })),

  updateRequestBody: (tabId, body) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], body },
      },
    })),

  updateRequestAuth: (tabId, auth) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], auth },
      },
    })),

  // ── Response Actions ─────────────────────────────────────────────────────
  setResponse: (tabId, response) =>
    set((s) => ({
      responses: { ...s.responses, [tabId]: response },
    })),

  setTestResults: (tabId, results) =>
    set((s) => ({
      testResults: { ...s.testResults, [tabId]: results },
    })),

  setLoading: (tabId, loading) =>
    set((s) => ({
      isLoading: { ...s.isLoading, [tabId]: loading },
    })),

  // ── History Actions ──────────────────────────────────────────────────────
  addHistoryEntry: (entry) => {
    set((s) => ({ history: [entry, ...s.history].slice(0, 200) }));
    dbHistory.create(entry as any).catch(() => {});
  },

  clearHistory: () => {
    set({ history: [] });
    dbHistory.clear().catch(() => {});
  },

  loadHistory: async () => {
    try {
      const records = await dbHistory.getRecent(200);
      set({ history: records as unknown as HistoryEntry[] });
    } catch {
      // storage unavailable
    }
  },

  recordCollectionRun: (run) => {
    set((s) => ({ collectionRuns: [run, ...s.collectionRuns].slice(0, 20) }));
  },

  setRunnerState: (collectionId, patch) =>
    set((s) => ({
      runnerStates: {
        ...s.runnerStates,
        [collectionId]: {
          ...(s.runnerStates[collectionId] ?? DEFAULT_RUNNER_STATE),
          ...patch,
        },
      },
    })),

  clearRunnerState: (collectionId) =>
    set((s) => {
      const next = { ...s.runnerStates };
      delete next[collectionId];
      return { runnerStates: next };
    }),

  // ── UI Actions ───────────────────────────────────────────────────────────
  setActiveRequestPanel: (panel) => set({ activeRequestPanel: panel }),
  setActiveResponsePanel: (panel) => set({ activeResponsePanel: panel }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setCodegenOpen: (open) => set({ codegenOpen: open }),
  setImportOpen: (open) => set({ importOpen: open }),
  setWebsocketOpen: (open) => set({ websocketOpen: open }),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem("kp-theme", theme);
    } catch {
      // ignore
    }
  },

  setUseRelay: (on) => {
    set({ useRelay: on });
    try {
      localStorage.setItem("kp-use-relay", on ? "1" : "0");
    } catch {
      // ignore
    }
  },

  setRelayUrl: (url) => {
    set({ relayUrl: url });
    try {
      localStorage.setItem("kp-relay-url", url);
    } catch {
      // ignore
    }
  },

  setTimeoutMs: (ms) => {
    set({ timeoutMs: ms });
    try {
      localStorage.setItem("kp-timeout-ms", String(ms));
    } catch {
      // ignore
    }
  },
}));
