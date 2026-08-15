import { create } from "zustand";
import type {
  Request,
  Response,
  Collection,
  Environment,
  HistoryEntry,
  KeyValuePair,
  BodyContent,
  AuthConfig,
  HttpMethod,
} from "@knockport/core";
import { createId } from "@knockport/core";

// ── Tab types ────────────────────────────────────────────────────────────────
export interface RequestTab {
  id: string;
  requestId: string;
  name: string;
  isDirty: boolean;
}

export type ActivePanel = "params" | "headers" | "auth" | "body" | "scripts" | "tests" | "settings";
export type ResponsePanel = "pretty" | "raw" | "preview" | "headers" | "timings" | "cookies";
export type SidebarTab = "collections" | "environments" | "history";

// ── App Store ────────────────────────────────────────────────────────────────
export interface AppStore {
  // Sidebar
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  sidebarCollapsed: boolean;

  // Collections
  collections: Collection[];
  activeCollectionId: string | null;

  // Environments
  environments: Environment[];
  activeEnvironmentId: string | null;

  // Request tabs
  tabs: RequestTab[];
  activeTabId: string | null;

  // Request state (keyed by tab ID)
  requests: Record<string, Request>;
  responses: Record<string, Response | null>;
  isLoading: Record<string, boolean>;

  // History
  history: HistoryEntry[];

  // UI
  activeRequestPanel: ActivePanel;
  activeResponsePanel: ResponsePanel;
  commandPaletteOpen: boolean;
  codegenOpen: boolean;
  importOpen: boolean;
  theme: "dark" | "light";

  // Actions — Sidebar
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;

  // Actions — Collections
  addCollection: (collection: Collection) => void;
  setActiveCollection: (id: string | null) => void;
  updateCollection: (id: string, changes: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;

  // Actions — Environments
  addEnvironment: (env: Environment) => void;
  setActiveEnvironment: (id: string | null) => void;
  updateEnvironment: (id: string, changes: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;

  // Actions — Tabs
  openTab: (request: Request) => void;
  closeTab: (tabId: string) => void;
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
  setLoading: (tabId: string, loading: boolean) => void;

  // Actions — History
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  // Actions — UI
  setActiveRequestPanel: (panel: ActivePanel) => void;
  setActiveResponsePanel: (panel: ResponsePanel) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setCodegenOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // ── Initial State ────────────────────────────────────────────────────────
  sidebarTab: "collections",
  sidebarWidth: 280,
  sidebarCollapsed: false,

  collections: [],
  activeCollectionId: null,

  environments: [],
  activeEnvironmentId: null,

  tabs: [],
  activeTabId: null,

  requests: {},
  responses: {},
  isLoading: {},

  history: [],

  activeRequestPanel: "params",
  activeResponsePanel: "pretty",
  commandPaletteOpen: false,
  codegenOpen: false,
  importOpen: false,
  theme: "dark",

  // ── Sidebar Actions ──────────────────────────────────────────────────────
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // ── Collection Actions ───────────────────────────────────────────────────
  addCollection: (collection) =>
    set((s) => ({ collections: [...s.collections, collection] })),
  setActiveCollection: (id) => set({ activeCollectionId: id }),
  updateCollection: (id, changes) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, ...changes } : c,
      ),
    })),
  deleteCollection: (id) =>
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      activeCollectionId: s.activeCollectionId === id ? null : s.activeCollectionId,
    })),

  // ── Environment Actions ──────────────────────────────────────────────────
  addEnvironment: (env) =>
    set((s) => ({ environments: [...s.environments, env] })),
  setActiveEnvironment: (id) => set({ activeEnvironmentId: id }),
  updateEnvironment: (id, changes) =>
    set((s) => ({
      environments: s.environments.map((e) =>
        e.id === id ? { ...e, ...changes } : e,
      ),
    })),
  deleteEnvironment: (id) =>
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvironmentId: s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
    })),

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
    }));
  },

  closeTab: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const newTabs = s.tabs.filter((t) => t.id !== tabId);
      let newActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null;
      }
      const newRequests = { ...s.requests };
      const newResponses = { ...s.responses };
      const newLoading = { ...s.isLoading };
      delete newRequests[tabId];
      delete newResponses[tabId];
      delete newLoading[tabId];
      return {
        tabs: newTabs,
        activeTabId: newActive,
        requests: newRequests,
        responses: newResponses,
        isLoading: newLoading,
      };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

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
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: true } : t,
      ),
    })),

  updateRequestUrl: (tabId, url) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [tabId]: { ...s.requests[tabId], url },
      },
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: true } : t,
      ),
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

  setLoading: (tabId, loading) =>
    set((s) => ({
      isLoading: { ...s.isLoading, [tabId]: loading },
    })),

  // ── History Actions ──────────────────────────────────────────────────────
  addHistoryEntry: (entry) =>
    set((s) => ({
      history: [entry, ...s.history].slice(0, 200),
    })),

  clearHistory: () => set({ history: [] }),

  // ── UI Actions ───────────────────────────────────────────────────────────
  setActiveRequestPanel: (panel) => set({ activeRequestPanel: panel }),
  setActiveResponsePanel: (panel) => set({ activeResponsePanel: panel }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setCodegenOpen: (open) => set({ codegenOpen: open }),
  setImportOpen: (open) => set({ importOpen: open }),
  toggleTheme: () =>
    set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
}));
