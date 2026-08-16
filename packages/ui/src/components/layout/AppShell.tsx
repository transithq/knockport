import { createId } from "@knockport/core";
import type { Request } from "@knockport/core";
import { Boxes, Braces, ChevronDown, MoreHorizontal, Play, Plus, Radio, Server, Settings, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { CollectionEditor } from "../collections/CollectionEditor";
import { CommandPalette } from "../command/CommandPalette";
import { useResizer } from "../common/useResizer";
import { DropdownMenu } from "../common/DropdownMenu";
import { EnvironmentEditor } from "../environments/EnvironmentEditor";
import { CodegenModal, ImportModal } from "../modals/Modals";
import { RequestEditor, handleSend } from "../request/RequestEditor";
import { ResponseBody } from "../response/ResponseBody";
import { ResponseSummary } from "../response/ResponseSummary";
import { RunnerTab } from "../runner/RunnerTab";
import { SettingsPage } from "../settings/SettingsPage";
import { WebSocketTab } from "../websocket/WebSocketTab";
import { ApiTab } from "../api/ApiTab";
import { MockTab } from "../mock/MockTab";
import { Sidebar } from "./Sidebar";

// ── Resizable workspace (request | response, with analytics rail) ────────────
// Pane constraints, Bruno-style pixel clamping.
const RIGHT_PANE_MIN = 300;
const RIGHT_PANE_MAX = 720;
const RIGHT_PANE_DEFAULT = 400;
const REQUEST_PANE_MIN = 180;
const RESPONSE_PANE_MIN = 200;
const REQUEST_PANE_DEFAULT = 320;

function WorkspaceGrid({ tabId }: { tabId: string }) {
  const rightPaneWidth = useAppStore((s) => s.rightPaneWidth);
  const requestPaneHeight = useAppStore((s) => s.requestPaneHeight);
  const gridRef = useRef<HTMLDivElement>(null);
  const colResizer = useResizer("x");
  const rowResizer = useResizer("y");

  // Re-clamp persisted pane sizes when the window shrinks (Bruno's
  // ResizeObserver guard) — keeps panels from overflowing their container.
  useEffect(() => {
    const clamp = () => {
      const s = useAppStore.getState();
      const w = gridRef.current?.clientWidth ?? Number.POSITIVE_INFINITY;
      const h = gridRef.current?.clientHeight ?? Number.POSITIVE_INFINITY;
      const rightMax = Math.min(RIGHT_PANE_MAX, Math.max(RIGHT_PANE_MIN, w - 420));
      if (s.rightPaneWidth > rightMax) s.setRightPaneWidth(rightMax);
      const reqMax = Math.max(REQUEST_PANE_MIN, h - RESPONSE_PANE_MIN - 16);
      if (s.requestPaneHeight > reqMax) s.setRequestPaneHeight(reqMax);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  return (
    <div className="kp-workspace-grid" ref={gridRef} style={{ gridTemplateColumns: `minmax(0, 1fr) 8px ${rightPaneWidth}px` }}>
      <div
        className="kp-col-left"
        style={{ gridTemplateRows: `minmax(0, ${requestPaneHeight}px) 8px minmax(0, 1fr)` }}
      >
        <div className="kp-pane-scroll">
          <RequestEditor tabId={tabId} />
        </div>
        <div
          className="kp-resize-handle horizontal"
          role="separator"
          aria-orientation="horizontal"
          onMouseDown={(e) =>
            rowResizer.start(e, {
              getValue: () => useAppStore.getState().requestPaneHeight,
              setValue: (h) => useAppStore.getState().setRequestPaneHeight(h),
              min: REQUEST_PANE_MIN,
              getMax: () =>
                Math.max(REQUEST_PANE_MIN, (gridRef.current?.clientHeight ?? 600) - RESPONSE_PANE_MIN),
              defaultSize: REQUEST_PANE_DEFAULT,
            })
          }
          onDoubleClick={() => useAppStore.getState().setRequestPaneHeight(REQUEST_PANE_DEFAULT)}
        />
        <div className="kp-pane-scroll kp-pane-scroll-flex">
          <ResponseBody tabId={tabId} />
        </div>
      </div>
      <div
        className="kp-resize-handle vertical"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(e) =>
          colResizer.start(e, {
            getValue: () => useAppStore.getState().rightPaneWidth,
            setValue: (w) => useAppStore.getState().setRightPaneWidth(w),
            min: RIGHT_PANE_MIN,
            getMax: () =>
              Math.min(RIGHT_PANE_MAX, Math.max(RIGHT_PANE_MIN, (gridRef.current?.clientWidth ?? 800) - 420)),
            invert: true,
            defaultSize: RIGHT_PANE_DEFAULT,
          })
        }
        onDoubleClick={() => useAppStore.getState().setRightPaneWidth(RIGHT_PANE_DEFAULT)}
      />
      <div className="kp-col-right">
        <ResponseSummary tabId={tabId} />
      </div>
    </div>
  );
}

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
              {tab.kind === "environment" ? (
                <Boxes size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "collection" ? (
                <Braces size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "runner" ? (
                <Play size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "settings" ? (
                <Settings size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "websocket" ? (
                <Radio size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "api" ? (
                <Braces size={12} className="kp-env-tab-icon" />
              ) : tab.kind === "mock" ? (
                <Server size={12} className="kp-env-tab-icon" />
              ) : (
                <span
                  className="kp-method-tag"
                  style={{ color: methodColor[req?.method ?? "GET"] }}
                >
                  {req?.method}
                </span>
              )}
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
        <DropdownMenu
          buttonClassName="kp-tabbar-btn"
          buttonTitle="More tab actions"
          buttonLabel={<MoreHorizontal size={15} />}
          items={[
            {
              label: "Close other tabs",
              onClick: () => {
                for (const t of tabs.filter((t) => t.id !== activeTabId)) closeTab(t.id);
              },
            },
            {
              label: "Close all tabs",
              onClick: () => {
                for (const t of [...tabs]) closeTab(t.id);
              },
            },
          ]}
        />
      </div>
    </div>
  );
}

function EnvironmentSelector() {
  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);

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
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
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
        <span className="kp-logo-mark large">
          <Boxes size={28} />
        </span>
      </div>
      <h1>KnockPort</h1>
      <p>The fast, light API client. Select a request from the sidebar or create a new one.</p>
      <div className="kp-welcome-actions">
        <button type="button" className="kp-btn primary" onClick={newRequest}>
          <Plus size={15} /> New Request
        </button>
        <button
          type="button"
          className="kp-btn secondary"
          onClick={() => setCommandPaletteOpen(true)}
        >
          Command Palette
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const theme = useAppStore((s) => s.theme);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const closeTab = useAppStore((s) => s.closeTab);
  const activeTab = tabs.find((t) => t.id === activeTabId);

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
      // Ctrl+Enter send / Ctrl+S save-to-collection (request tabs only,
      // suppressed while any modal or the command palette is open)
      if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
        const s = useAppStore.getState();
        if (s.commandPaletteOpen || s.codegenOpen || s.importOpen) return;
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!tab || (tab.kind && tab.kind !== "request")) return;
        e.preventDefault();
        if (e.key === "Enter") handleSend(tab.id);
        else s.saveRequestTab(tab.id);
      }
      if (e.key === "Escape") {
        const s = useAppStore.getState();
        if (s.codegenOpen) s.setCodegenOpen(false);
        else if (s.importOpen) s.setImportOpen(false);
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
            <button
              type="button"
              className="kp-icon-btn"
              title="Settings"
              onClick={() => useAppStore.getState().openSettingsTab()}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        {activeTab ? (
          activeTab.kind === "environment" ? (
            <EnvironmentEditor envId={activeTab.envId ?? ""} />
          ) : activeTab.kind === "collection" ? (
            <CollectionEditor collectionId={activeTab.collectionId ?? ""} />
          ) : activeTab.kind === "runner" ? (
            <RunnerTab collectionId={activeTab.collectionId ?? ""} />
          ) : activeTab.kind === "settings" ? (
            <SettingsPage />
          ) : activeTab.kind === "websocket" ? (
            <WebSocketTab />
          ) : activeTab.kind === "api" ? (
            <ApiTab />
          ) : activeTab.kind === "mock" ? (
            <MockTab />
          ) : (
            <WorkspaceGrid tabId={activeTab.id} />
          )
        ) : (
          <WelcomeScreen />
        )}
      </main>
      <CommandPalette />
      <CodegenModal />
      <ImportModal />
    </div>
  );
}
