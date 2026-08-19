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
  RequestExample,
  Response,
} from "@knockport/core";
import { createId } from "@knockport/core";
import type { CookieJar } from "@knockport/core";
import { loadCookieJar, persistCookieJar } from "./cookie-jar";
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
  kind?:
    | "request"
    | "environment"
    | "collection"
    | "folder"
    | "runner"
    | "settings"
    | "websocket"
    | "api"
    | "mock"
    | "sse"
    | "mqtt"
    | "cookies";
  envId?: string;
  collectionId?: string;
}

export type ActivePanel = "params" | "headers" | "auth" | "body" | "vars" | "scripts" | "tests";
export type ResponsePanel = "body" | "cookies" | "headers" | "tests" | "examples";
export type SidebarTab = "collections" | "environments" | "history";

/** Response pane placement (F6, Bruno parity). */
export type ResponseLayout = "below" | "beside";

/**
 * Bodies above this size are held behind a "show anyway" guard (F6):
 * rendering several MB of text through CodeMirror freezes the UI thread.
 */
export const LARGE_RESPONSE_BYTES = 1_000_000;

export type WsTabStatus = "idle" | "connecting" | "open" | "closed" | "error";

// ── WebSocket log entry ──────────────────────────────────────────────────────
export interface WsLogEntry {
  dir: "in" | "out" | "sys";
  text: string;
  time: string;
  size?: number;
}

// ── Server-Sent Events workspace (single tab) ────────────────────────────────
export type SseStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface SseEventEntry {
  event: string;
  data: string;
  id?: string;
  time: string;
}

// ── MQTT workspace (single tab) ──────────────────────────────────────────────
export type MqttStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface MqttLogEntry {
  dir: "in" | "out" | "sys";
  topic: string;
  text: string;
  time: string;
}

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
  /** D3: stop the run after the first failed/errored request (bail). */
  stopOnError: boolean;
  /** D3: carry script-set variable values into subsequent requests. */
  keepVariableValues: boolean;
  /** D3: retain full response bodies in the results for inspection. */
  persistResponses: boolean;
  /** D3: run against a specific environment instead of the active one. */
  runnerEnvironmentId: string | null;
  /** D3: merge the active environment's variables under the runner env. */
  includeActiveEnv: boolean;
  /** Set when a run was stopped early by stop-on-error. */
  stoppedReason?: string;
}

export const DEFAULT_RUNNER_STATE: RunnerTabState = {
  phase: "config",
  iterations: 1,
  delay: 0,
  excluded: [],
  results: [],
  selectedIdx: null,
  filter: "all",
  stopOnError: false,
  keepVariableValues: true,
  persistResponses: true,
  runnerEnvironmentId: null,
  includeActiveEnv: true,
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
export type RelayHealth = "off" | "checking" | "up" | "down";

export interface AppStore {
  // Sidebar
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Nav menu section height in px (0 = auto, hug contents). */
  navHeight: number;

  // Workspace layout (resizable panes, persisted)
  /** Right analytics column width in px. */
  rightPaneWidth: number;
  /** Request pane height in px (response fills the rest). */
  requestPaneHeight: number;
  /** Response pane placement: stacked under the request or beside it. */
  responseLayout: ResponseLayout;
  /** Response pane width in px (beside layout only). */
  responsePaneWidth: number;
  /** Tab IDs whose large-response guard was dismissed ("show anyway"). */
  largeBodyDismissed: Record<string, true>;

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
  /** A1: last send's extracted response variables (vars.post-response). */
  extractedVars: Record<string, Record<string, string> | null>;
  isLoading: Record<string, boolean>;

  // Persistent cookie jar (G1): captured from responses, re-attached on sends.
  cookieJar: CookieJar;

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
  interfaceOpen: boolean;
  /** Pending prompt-variable dialog (A5): answers resolve on Send. */
  promptVars: { names: string[]; resolve: (answers: Record<string, string> | null) => void } | null;
  /** Inherited-scripts viewer (C10): the request whose script chain is shown; null = closed. */
  inheritScriptsRequest: string | null;

  // ── WebSocket workspace (single tab; state survives tab switches) ──
  wsUrl: string;
  wsStatus: "idle" | "connecting" | "open" | "closed" | "error";
  wsLog: WsLogEntry[];

  // ── SSE workspace ──
  sseUrl: string;
  sseStatus: SseStatus;
  sseLog: SseEventEntry[];
  sseLastEventId: string | null;

  // ── MQTT workspace ──
  mqttUrl: string;
  mqttStatus: MqttStatus;
  mqttLog: MqttLogEntry[];
  mqttTopics: string[];
  theme: "dark" | "light";

  // Transport settings (relay)
  useRelay: boolean;
  relayUrl: string;
  relayToken: string;
  relayHealth: "off" | "checking" | "up" | "down";

  // Global request timeout (ms) applied to every send
  timeoutMs: number;

  // Actions — Sidebar
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  setNavHeight: (height: number) => void;
  toggleSidebar: () => void;

  // Actions — Layout panes
  setRightPaneWidth: (width: number) => void;
  setRequestPaneHeight: (height: number) => void;
  setResponseLayout: (layout: ResponseLayout) => void;
  setResponsePaneWidth: (width: number) => void;
  dismissLargeBody: (tabId: string) => void;

  // Actions — Collections
  addCollection: (collection: Collection) => void;
  setActiveCollection: (id: string | null) => void;
  toggleNode: (id: string) => void;
  setDiskRoot: (collectionId: string, rootName: string | null) => void;
  updateCollection: (id: string, changes: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  addFolder: (collectionId: string, parentFolderId: string | null, name: string) => void;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  /** Patch a folder's settings (name, auth, scripts, variables, …). */
  updateFolder: (collectionId: string, folderId: string, changes: Partial<Folder>) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  addRequest: (collectionId: string, folderId: string | null, name?: string) => void;
  addExistingRequest: (collectionId: string, folderId: string | null, request: Request) => void;
  deleteRequest: (collectionId: string, requestId: string) => void;
  loadCollections: () => Promise<void>;

  // Actions — Environments
  addEnvironment: (env: Environment) => void;
  setActiveEnvironment: (id: string | null) => void;
  updateEnvironment: (id: string, changes: Partial<Environment>) => void;
  /** Mark/unmark the global environment (isDefault; lowest-precedence layer). */
  setGlobalEnvironment: (id: string | null) => void;
  deleteEnvironment: (id: string) => void;
  loadEnvironments: () => Promise<void>;

  // Actions — Tabs
  openTab: (request: Request) => void;
  openEnvironmentTab: (envId: string) => void;
  openCollectionTab: (collectionId: string) => void;
  openFolderTab: (collectionId: string, folderId: string) => void;
  openRunnerTab: (collectionId: string) => void;
  openSettingsTab: () => void;
  openCookieJarTab: () => void;
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

  // Actions — Request examples (F4)
  /** Save the tab's current request + response as an example on the request. */
  saveRequestExample: (tabId: string) => void;
  /** Delete one saved example by id. */
  deleteRequestExample: (tabId: string, exampleId: string) => void;
  /** Delete every saved example on the request. */
  deleteAllRequestExamples: (tabId: string) => void;
  /** Open a saved example: load its request into a tab and show its response. */
  openRequestExample: (example: RequestExample) => void;

  // Actions — Response
  setResponse: (tabId: string, response: Response | null) => void;
  /** A1: record the extracted response variables (null = none this send). */
  setExtractedVars: (tabId: string, vars: Record<string, string> | null, keys?: string[]) => void;
  setTestResults: (tabId: string, results: TestRunSummary | null) => void;
  setLoading: (tabId: string, loading: boolean) => void;

  // Actions — Cookie jar (G1/G2)
  /** Capture a completed response's Set-Cookie headers into the jar. */
  captureResponseCookies: (response: Response) => void;
  /** Persist the jar (bru.cookies.* script mutations) and rehydrate (C8). */
  syncCookieJar: () => void;
  /** Set or replace a cookie manually (G2 edit / import). */
  setCookie: (url: string, cookie: { key: string; value: string; path?: string; secure?: boolean; httpOnly?: boolean; sameSite?: "Strict" | "Lax" | "None"; expires?: number }) => void;
  /** Replace a stored cookie in place, preserving its exact scope (G2 edit). */
  updateCookie: (cookie: import("@knockport/core").StoredCookie) => void;
  /** Delete one stored cookie by exact domain/path/name (G2). */
  deleteCookie: (domain: string, path: string, key: string) => void;
  /** Delete every cookie scoped to a URL (C8 `clear` from the manager). */
  clearCookiesForUrl: (url: string) => void;
  /** Delete all cookies for one domain (G2 per-domain clear). */
  clearCookieDomain: (domain: string) => void;
  /** Wipe the whole jar (G2 clear-all). */
  clearCookieJar: () => void;

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
  setInterfaceOpen: (open: boolean) => void;
  setPromptVars: (
    pending: { names: string[]; resolve: (answers: Record<string, string> | null) => void } | null,
  ) => void;
  setInheritScriptsRequest: (requestId: string | null) => void;
  openWebSocketTab: () => void;
  openApiTab: () => void;
  openMockTab: () => void;
  setWsUrl: (url: string) => void;
  setWsStatus: (status: "idle" | "connecting" | "open" | "closed" | "error") => void;
  pushWsLog: (entry: WsLogEntry) => void;
  clearWsLog: () => void;
  openSseTab: () => void;
  openMqttTab: () => void;
  setSseUrl: (url: string) => void;
  setSseStatus: (status: SseStatus) => void;
  pushSseLog: (entry: SseEventEntry) => void;
  clearSseLog: () => void;
  setSseLastEventId: (id: string | null) => void;
  setMqttUrl: (url: string) => void;
  setMqttStatus: (status: MqttStatus) => void;
  pushMqttLog: (entry: MqttLogEntry) => void;
  clearMqttLog: () => void;
  addMqttTopic: (topic: string) => void;
  removeMqttTopic: (topic: string) => void;
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setUseRelay: (on: boolean) => void;
  setRelayUrl: (url: string) => void;
  setTimeoutMs: (ms: number) => void;
  setRelayToken: (token: string) => void;
  probeRelay: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // ── Initial State ────────────────────────────────────────────────────────
  sidebarTab: "collections",
  sidebarWidth:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-sidebar-width") ?? "", 10)) ||
    280,
  sidebarCollapsed: false,
  navHeight:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-nav-height") ?? "", 10)) ||
    0,

  rightPaneWidth:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-right-pane-width") ?? "", 10)) ||
    400,
  requestPaneHeight:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-request-pane-height") ?? "", 10)) ||
    320,
  responseLayout:
    (typeof localStorage !== "undefined" &&
      localStorage.getItem("kp-response-layout") === "beside")
      ? "beside"
      : "below",
  responsePaneWidth:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-response-pane-width") ?? "", 10)) ||
    480,
  largeBodyDismissed: {},

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
  extractedVars: {},
  isLoading: {},

  history: [],

  collectionRuns: [],
  runnerStates: {},

  activeRequestPanel: "params",
  activeResponsePanel: "body",
  commandPaletteOpen: false,
  codegenOpen: false,
  importOpen: false,
  interfaceOpen: false,
  promptVars: null,
  inheritScriptsRequest: null,
  wsUrl: (typeof localStorage !== "undefined" && localStorage.getItem("kp-ws-url")) || "wss://echo.websocket.org",
  wsStatus: "idle" as WsTabStatus,
  wsLog: [],

  sseUrl:
    (typeof localStorage !== "undefined" && localStorage.getItem("kp-sse-url")) ||
    "https://stream.wikimedia.org/v2/stream/recentchange",
  sseStatus: "idle" as SseStatus,
  sseLog: [],
  sseLastEventId: null,

  mqttUrl:
    (typeof localStorage !== "undefined" && localStorage.getItem("kp-mqtt-url")) ||
    "wss://test.mosquitto.org:8081/mqtt",
  mqttStatus: "idle" as MqttStatus,
  mqttLog: [],
  mqttTopics: [],
  theme:
    typeof localStorage !== "undefined" && localStorage.getItem("kp-theme") === "light"
      ? "light"
      : "dark",

  useRelay: typeof localStorage !== "undefined" && localStorage.getItem("kp-use-relay") === "1",
  relayUrl:
    (typeof localStorage !== "undefined" && localStorage.getItem("kp-relay-url")) ||
    "http://localhost:8787",
  relayToken: (typeof localStorage !== "undefined" && localStorage.getItem("kp-relay-token")) || "",
  relayHealth: "off" as RelayHealth,

  timeoutMs:
    (typeof localStorage !== "undefined" &&
      Number.parseInt(localStorage.getItem("kp-timeout-ms") ?? "", 10)) ||
    30000,

  cookieJar: loadCookieJar(),

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
  setNavHeight: (height) => {
    set({ navHeight: height });
    try {
      localStorage.setItem("kp-nav-height", String(height));
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
  setResponseLayout: (layout) => {
    set({ responseLayout: layout });
    try {
      localStorage.setItem("kp-response-layout", layout);
    } catch {
      /* storage unavailable */
    }
  },
  setResponsePaneWidth: (width) => {
    set({ responsePaneWidth: width });
    try {
      localStorage.setItem("kp-response-pane-width", String(width));
    } catch {
      /* storage unavailable */
    }
  },
  dismissLargeBody: (tabId) =>
    set((s) => ({ largeBodyDismissed: { ...s.largeBodyDismissed, [tabId]: true } })),

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

  updateFolder: (collectionId, folderId, changes) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, folders: mapFolderTree(c.folders, folderId, (f) => ({ ...f, ...changes })) }
          : c,
      ),
      // Keep any open folder tab's title in sync with the name
      tabs: changes.name
        ? s.tabs.map((t) =>
            t.kind === "folder" && t.collectionId === collectionId && t.requestId === `fld:${folderId}`
              ? { ...t, name: changes.name as string }
              : t,
          )
        : s.tabs,
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

  addExistingRequest: (collectionId, folderId, request) => {
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
      const extractedVars = { ...s.extractedVars };
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
          delete extractedVars[id];
        }
      }
      const c = collections.find((x) => x.id === collectionId);
      if (c) persistCollection(c);
      return {
        collections,
        tabs,
        activeTabId,
        requests,
        responses,
        testResults,
        isLoading,
        extractedVars,
      };
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
  setGlobalEnvironment: (id) => {
    set((s) => ({
      environments: s.environments.map((e) => ({
        ...e,
        isDefault: id !== null && e.id === id,
      })),
    }));
    // isDefault is part of the record — persist every touched environment.
    for (const e of get().environments) persistEnvironment(e);
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
      const newExtractedVars = { ...s.extractedVars };
      delete newRequests[tabId];
      delete newResponses[tabId];
      delete newTestResults[tabId];
      delete newLoading[tabId];
      delete newExtractedVars[tabId];
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
        extractedVars: newExtractedVars,
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

  // ── Request examples (F4) ─────────────────────────────────────────────────
  // Examples live on the Request object itself (persisted with the collection
  // through the usual replaceRequestInFolders + persistCollection path), and
  // on the tab copy so the response pane / tab label stay in sync.
  saveRequestExample: (tabId) => {
    const prev = get();
    const tab = prev.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const current = prev.requests[tabId];
    const response = prev.responses[tabId];
    if (!current || !response) return;
    const example: RequestExample = {
      id: createId("ex"),
      request: current,
      response,
      timestamp: new Date().toISOString(),
    };
    const withExample = (r: Request): Request => ({
      ...r,
      examples: [...(r.examples ?? []), example],
    });
    set((s) => ({
      requests: { ...s.requests, [tabId]: withExample(current) },
    }));
    const col = findOwningCollection(prev.collections, current.id);
    if (col) {
      const updated: Collection = {
        ...col,
        requests: col.requests.map((r) => (r.id === current.id ? withExample(r) : r)),
        folders: replaceRequestInFolders(col.folders, current.id, {
          ...current,
          examples: [...(current.examples ?? []), example],
        }),
      };
      set((st) => ({
        collections: st.collections.map((c) => (c.id === col.id ? updated : c)),
      }));
      persistCollection(updated);
    }
  },

  deleteRequestExample: (tabId, exampleId) => {
    const prev = get();
    const current = prev.requests[tabId];
    if (!current) return;
    const without = (r: Request): Request => ({
      ...r,
      examples: (r.examples ?? []).filter((e) => e.id !== exampleId),
    });
    set((s) => ({
      requests: { ...s.requests, [tabId]: without(current) },
    }));
    const col = findOwningCollection(prev.collections, current.id);
    if (col) {
      const updated: Collection = {
        ...col,
        requests: col.requests.map((r) => (r.id === current.id ? without(r) : r)),
        folders: replaceRequestInFolders(col.folders, current.id, without(current)),
      };
      set((st) => ({
        collections: st.collections.map((c) => (c.id === col.id ? updated : c)),
      }));
      persistCollection(updated);
    }
  },

  deleteAllRequestExamples: (tabId) => {
    const prev = get();
    const current = prev.requests[tabId];
    if (!current) return;
    const cleared = (r: Request): Request => ({ ...r, examples: undefined });
    set((s) => ({
      requests: { ...s.requests, [tabId]: cleared(current) },
    }));
    const col = findOwningCollection(prev.collections, current.id);
    if (col) {
      const updated: Collection = {
        ...col,
        requests: col.requests.map((r) => (r.id === current.id ? cleared(r) : r)),
        folders: replaceRequestInFolders(col.folders, current.id, cleared(current)),
      };
      set((st) => ({
        collections: st.collections.map((c) => (c.id === col.id ? updated : c)),
      }));
      persistCollection(updated);
    }
  },

  openRequestExample: (example) => {
    const s = get();
    s.openTab({ ...example.request });
    const active = get().tabs.find((t) => t.requestId === example.request.id);
    if (active) get().setResponse(active.id, example.response);
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

  openFolderTab: (collectionId, folderId) => {
    const s = get();
    const col = s.collections.find((c) => c.id === collectionId);
    if (!col) return;
    const findFolder = (folders: Folder[]): Folder | undefined => {
      for (const f of folders) {
        if (f.id === folderId) return f;
        const nested = findFolder(f.folders);
        if (nested) return nested;
      }
      return undefined;
    };
    const folder = findFolder(col.folders);
    if (!folder) return;
    const existing = s.tabs.find(
      (t) => t.kind === "folder" && t.requestId === `fld:${folderId}` && t.collectionId === collectionId,
    );
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
          requestId: `fld:${folderId}`,
          collectionId,
          kind: "folder",
          name: folder.name,
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

  openCookieJarTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "cookies");
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
          requestId: "cookies",
          kind: "cookies",
          name: "Cookie Jar",
          isDirty: false,
        },
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
  setExtractedVars: (tabId, vars, keys) =>
    set((s) => {
      const extractedVars = { ...s.extractedVars };
      if (!vars) {
        delete extractedVars[tabId];
      } else {
        const picked: Record<string, string> = {};
        for (const k of keys ?? Object.keys(vars)) {
          if (vars[k] !== undefined) picked[k] = vars[k];
        }
        extractedVars[tabId] = picked;
      }
      return { extractedVars };
    }),

  setResponse: (tabId, response) =>
    set((s) => {
      // A fresh response resets the large-body guard dismissal for this tab
      // so every new response is re-evaluated against the size threshold.
      const largeBodyDismissed = { ...s.largeBodyDismissed };
      delete largeBodyDismissed[tabId];
      return {
        responses: { ...s.responses, [tabId]: response },
        largeBodyDismissed,
      };
    }),

  setTestResults: (tabId, results) =>
    set((s) => ({
      testResults: { ...s.testResults, [tabId]: results },
    })),

  setLoading: (tabId, loading) =>
    set((s) => ({
      isLoading: { ...s.isLoading, [tabId]: loading },
    })),

  // ── Cookie jar actions (G1/G2) ────────────────────────────────────────────
  captureResponseCookies: (response) =>
    set((s) => {
      const jar = s.cookieJar;
      if (!response.url) return {};
      jar.setFromResponse(response.url, response.cookies);
      persistCookieJar(jar);
      // Rehydrate so the manager tab re-renders with the fresh set.
      return { cookieJar: loadCookieJar() };
    }),

  setCookie: (url, cookie) =>
    set((s) => {
      s.cookieJar.upsert(url, cookie);
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  updateCookie: (cookie) =>
    set((s) => {
      s.cookieJar.setStored(cookie);
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  deleteCookie: (domain, path, key) =>
    set((s) => {
      s.cookieJar.deleteCookie(domain, path, key);
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  clearCookiesForUrl: (url) =>
    set((s) => {
      s.cookieJar.deleteCookiesForUrl(url);
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  clearCookieDomain: (domain) =>
    set((s) => {
      s.cookieJar.deleteDomain(domain);
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  clearCookieJar: () =>
    set((s) => {
      s.cookieJar.clear();
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

  // Persist script-side jar mutations (bru.cookies.* in pre/post/test
  // scripts mutate the store's jar object in place) and rehydrate so the
  // cookie manager reflects them.
  syncCookieJar: () =>
    set((s) => {
      persistCookieJar(s.cookieJar);
      return { cookieJar: loadCookieJar() };
    }),

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
  setInterfaceOpen: (open) => set({ interfaceOpen: open }),
  setPromptVars: (pending) => set({ promptVars: pending }),
  setInheritScriptsRequest: (requestId) => set({ inheritScriptsRequest: requestId }),
  openWebSocketTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "websocket");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [
        ...st.tabs,
        { id: tabId, requestId: "websocket", kind: "websocket", name: "WebSocket", isDirty: false },
      ],
      activeTabId: tabId,
    }));
  },

  openApiTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "api");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [...st.tabs, { id: tabId, requestId: "api", kind: "api", name: "APIs", isDirty: false }],
      activeTabId: tabId,
    }));
  },

  openMockTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "mock");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [...st.tabs, { id: tabId, requestId: "mock", kind: "mock", name: "Mock Servers", isDirty: false }],
      activeTabId: tabId,
    }));
  },

  setWsUrl: (url) => {
    set({ wsUrl: url });
    try {
      localStorage.setItem("kp-ws-url", url);
    } catch {
      // ignore
    }
  },

  setWsStatus: (status) => set({ wsStatus: status }),

  pushWsLog: (entry) => set((s) => ({ wsLog: [...s.wsLog.slice(-499), entry] })),

  clearWsLog: () => set({ wsLog: [] }),

  openSseTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "sse");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [...st.tabs, { id: tabId, requestId: "sse", kind: "sse", name: "SSE", isDirty: false }],
      activeTabId: tabId,
    }));
  },

  openMqttTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "mqtt");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tabId = createId("tab");
    set((st) => ({
      tabs: [...st.tabs, { id: tabId, requestId: "mqtt", kind: "mqtt", name: "MQTT", isDirty: false }],
      activeTabId: tabId,
    }));
  },

  setSseUrl: (url) => {
    set({ sseUrl: url });
    try {
      localStorage.setItem("kp-sse-url", url);
    } catch {
      // ignore
    }
  },

  setSseStatus: (status) => set({ sseStatus: status }),

  pushSseLog: (entry) => set((s) => ({ sseLog: [...s.sseLog.slice(-499), entry] })),

  clearSseLog: () => set({ sseLog: [] }),

  setSseLastEventId: (id) => set({ sseLastEventId: id }),

  setMqttUrl: (url) => {
    set({ mqttUrl: url });
    try {
      localStorage.setItem("kp-mqtt-url", url);
    } catch {
      // ignore
    }
  },

  setMqttStatus: (status) => set({ mqttStatus: status }),

  pushMqttLog: (entry) => set((s) => ({ mqttLog: [...s.mqttLog.slice(-499), entry] })),

  clearMqttLog: () => set({ mqttLog: [] }),

  addMqttTopic: (topic) =>
    set((s) => (s.mqttTopics.includes(topic) ? s : { mqttTopics: [...s.mqttTopics, topic] })),

  removeMqttTopic: (topic) =>
    set((s) => ({ mqttTopics: s.mqttTopics.filter((t) => t !== topic) })),
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

  setRelayToken: (token) => {
    set({ relayToken: token });
    try {
      localStorage.setItem("kp-relay-token", token);
    } catch {
      // ignore
    }
  },

  probeRelay: async () => {
    const { useRelay, relayUrl } = get();
    if (!useRelay || !relayUrl) {
      set({ relayHealth: "off" });
      return;
    }
    set({ relayHealth: "checking" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${relayUrl.replace(/\/+$/, "")}/health`, {
        signal: controller.signal,
      });
      set({ relayHealth: res.ok ? "up" : "down" });
    } catch {
      set({ relayHealth: "down" });
    } finally {
      clearTimeout(timer);
    }
  },
}));
