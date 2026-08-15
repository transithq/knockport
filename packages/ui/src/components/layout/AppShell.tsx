import { useEffect } from "react";
import {
  Plus,
  MoreHorizontal,
  Settings,
  ChevronDown,
  X,
  Boxes,
} from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { Sidebar } from "./Sidebar";
import { RequestEditor } from "../request/RequestEditor";
import { ResponseBody } from "../response/ResponseBody";
import { ResponseSummary } from "../response/ResponseSummary";
import { CommandPalette } from "../command/CommandPalette";
import { CodegenModal, ImportModal, EnvironmentEditorModal } from "../modals/Modals";
import { RunnerModal } from "../runner/RunnerModal";
import { WebSocketModal } from "../websocket/WebSocketModal";
import { createId } from "@knockport/core";
import type { Request } from "@knockport/core";

const methodColor: Record<string, string> = {
  GET: "var(--kp-method-get)",
  POST: "var(--kp-method-post)",
  PUT: "var(--kp-method-put)",
  PATCH: "var(--kp-method-patch)",
  DELETE: "var(--kp-method-delete)",
  HEAD: "var(--kp-method-head)",
  OPTIONS: "var(--kp-method-options)",
};

function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const requests = useAppStore((s) => s.requests);
  const openTab = useAppStore((s) => s.openTab);

  const newRequest = () => {
    const req: Request = {
      id: createId("req"),
      name: "Untitled Request",
      method: "GET",
      url: "",
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "none" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    openTab(req);
  };

  return (
    <div className="kp-tabbar">
      <div className="kp-tabbar-tabs kp-scroll">
        {tabs.map((tab) => {
          const req = requests[tab.id];
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`kp-tab${active ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={active}
            >
              <span className="kp-method-tag" style={{ color: methodColor[req?.method ?? "GET"] }}>
                {req?.method}
              </span>
              <span className="kp-truncate kp-tab-name">{tab.name}</span>
              {active && (
                <button
                  type="button"
                  className="kp-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="kp-tabbar-btn" onClick={newRequest} title="New request">
          <Plus size={15} />
        </button>
        <button type="button" className="kp-tabbar-btn" title="More">
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  );
}

function EnvironmentSelector() {
  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const active = environments.find((e) => e.id === activeEnvironmentId);

  return (
    <div className="kp-env-selector">
      <Boxes size={14} />
      <select
        className="kp-env-select"
        value={activeEnvironmentId ?? ""}
        onChange={(e) => setActiveEnvironment(e.target.value || null)}
      >
        {environments.length === 0 && <option value="">No Environment</option>}
        {environments.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}

function WelcomeScreen() {
  const openTab = useAppStore((s) => s.openTab);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const newRequest = () => {
    const req: Request = {
      id: createId("req"),
      name: "Untitled Request",
      method: "GET",
      url: "",
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "none" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    openTab(req);
  };

  return (
    <div className="kp-welcome">
      <div className="kp-welcome-logo">
        <span className="kp-logo-mark large"><Boxes size={28} /></span>
      </div>
      <h1>KnockPort</h1>
      <p>The fast, light API client. Select a request from the sidebar or create a new one.</p>
      <div className="kp-welcome-actions">
        <button type="button" className="kp-btn primary" onClick={newRequest}>
          <Plus size={15} /> New Request
        </button>
        <button type="button" className="kp-btn secondary" onClick={() => setCommandPaletteOpen(true)}>
          Command Palette
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const theme = useAppStore((s) => s.theme);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const closeTab = useAppStore((s) => s.closeTab);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w" && activeTabId) {
        e.preventDefault();
        closeTab(activeTabId);
      }
      if (e.key === "Escape") {
        const s = useAppStore.getState();
        if (s.codegenOpen) s.setCodegenOpen(false);
        else if (s.importOpen) s.setImportOpen(false);
        else if (s.runnerOpen) s.setRunnerOpen(false);
        else if (s.websocketOpen) s.setWebsocketOpen(false);
        else if (s.envEditorId) s.setEnvEditor(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, closeTab, setCommandPaletteOpen]);

  return (
    <div className="kp-app">
      <Sidebar />
      <main className="kp-main">
        <div className="kp-main-topbar">
          <TabBar />
          <div className="kp-main-topbar-right">
            <EnvironmentSelector />
            <button type="button" className="kp-icon-btn" title="Settings">
              <Settings size={16} />
            </button>
          </div>
        </div>

        {activeTabId ? (
          <div className="kp-workspace-grid">
            <div className="kp-col-left">
              <RequestEditor tabId={activeTabId} />
              <ResponseBody tabId={activeTabId} />
            </div>
            <div className="kp-col-right">
              <ResponseSummary tabId={activeTabId} />
            </div>
          </div>
        ) : (
          <WelcomeScreen />
        )}
      </main>
      <CommandPalette />
      <CodegenModal />
      <ImportModal />
      <RunnerModal />
      <WebSocketModal />
      <EnvironmentEditorModal />
    </div>
  );
}
