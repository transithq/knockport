import React, { useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { Sidebar } from "./Sidebar";
import { RequestEditor } from "../request/RequestEditor";
import { ResponseViewer } from "../response/ResponseViewer";
import { CommandPalette } from "../command/CommandPalette";
import { X, PanelRightClose, PanelRightOpen, Moon, Sun } from "lucide-react";
import { clsx } from "clsx";

// ── AppShell ─────────────────────────────────────────────────────────────────
export function AppShell() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    requests,
    commandPaletteOpen,
    setCommandPaletteOpen,
    theme,
    toggleTheme,
    sidebarCollapsed,
    toggleSidebar,
  } = useAppStore();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      // Cmd/Ctrl+W → close active tab
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, activeTabId, setCommandPaletteOpen, closeTab]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--kp-bg-primary)]" data-theme={theme}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        <div className="flex items-center h-9 border-b border-[var(--kp-border-primary)] bg-[var(--kp-bg-secondary)]">
          {/* Sidebar toggle */}
          <button
            onClick={toggleSidebar}
            className="px-2 h-full text-[var(--kp-text-muted)] hover:text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)] transition-colors"
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>

          {/* Tabs */}
          <div className="flex items-center flex-1 overflow-x-auto">
            {tabs.map((tab) => {
              const request = requests[tab.id];
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "group flex items-center gap-1.5 h-full px-3 cursor-pointer border-r border-[var(--kp-border-primary)] text-xs select-none",
                    isActive
                      ? "bg-[var(--kp-bg-primary)] text-[var(--kp-text-primary)]"
                      : "bg-[var(--kp-bg-secondary)] text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-tertiary)]",
                  )}
                >
                  {request && (
                    <span
                      className={clsx(
                        "text-[10px] font-bold",
                        getMethodColor(request.method),
                      )}
                    >
                      {request.method}
                    </span>
                  )}
                  <span className="truncate max-w-[120px]">
                    {tab.name}
                    {tab.isDirty && <span className="ml-1 text-[var(--kp-accent)]">*</span>}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--kp-bg-hover)] text-[var(--kp-text-muted)] hover:text-[var(--kp-text-primary)] transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 shrink-0">
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--kp-text-muted)] hover:text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)] transition-colors"
              title="Command palette (Ctrl+K)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
              </svg>
              <span className="hidden sm:inline">⌘K</span>
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md text-[var(--kp-text-muted)] hover:text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)] transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>

        {/* Content area — request + response */}
        {tabs.length > 0 ? (
          <div className="flex flex-1 min-h-0">
            {/* Request editor */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <RequestEditor />
            </div>

            {/* Response viewer */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <ResponseViewer />
            </div>
          </div>
        ) : (
          <WelcomeScreen />
        )}
      </div>

      {/* Command palette overlay */}
      {commandPaletteOpen && <CommandPalette />}
    </div>
  );
}

// ── Welcome Screen ───────────────────────────────────────────────────────────
function WelcomeScreen() {
  const { openTab, setCommandPaletteOpen } = useAppStore();

  const createNewRequest = () => {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    openTab({
      id: `req_${id}`,
      name: "Untitled Request",
      method: "GET",
      url: "",
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "inherit" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-[var(--kp-accent)] flex items-center justify-center shadow-lg">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[var(--kp-text-primary)]">KnockPort</h1>
        <p className="text-sm text-[var(--kp-text-secondary)] text-center max-w-md">
          The API client with one engine, every protocol, and a real plugin system.
          Fast, light, and git-native.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={createNewRequest}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] hover:bg-[var(--kp-bg-hover)] hover:border-[var(--kp-border-secondary)] transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-md bg-[var(--kp-accent-muted)] flex items-center justify-center text-[var(--kp-accent)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--kp-text-primary)]">New Request</div>
            <div className="text-xs text-[var(--kp-text-tertiary)]">Create an HTTP request</div>
          </div>
        </button>

        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] hover:bg-[var(--kp-bg-hover)] hover:border-[var(--kp-border-secondary)] transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-md bg-[var(--kp-info-bg)] flex items-center justify-center text-[var(--kp-info)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--kp-text-primary)]">Command Palette</div>
            <div className="text-xs text-[var(--kp-text-tertiary)]">Ctrl+K to search actions</div>
          </div>
        </button>
      </div>

      {/* Footer shortcuts */}
      <div className="flex gap-4 text-xs text-[var(--kp-text-muted)]">
        <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] text-[10px]">Ctrl+K</kbd> Commands</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] text-[10px]">Ctrl+W</kbd> Close tab</span>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: "text-[var(--kp-method-get)]",
    POST: "text-[var(--kp-method-post)]",
    PUT: "text-[var(--kp-method-put)]",
    PATCH: "text-[var(--kp-method-patch)]",
    DELETE: "text-[var(--kp-method-delete)]",
    HEAD: "text-[var(--kp-method-head)]",
    OPTIONS: "text-[var(--kp-method-options)]",
  };
  return colors[method] ?? "text-[var(--kp-text-secondary)]";
}
