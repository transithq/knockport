import React from "react";
import { useAppStore, type SidebarTab } from "../../store/app-store";
import {
  FolderTree,
  Globe,
  Clock,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
} from "lucide-react";
import { clsx } from "clsx";

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar() {
  const { sidebarTab, setSidebarTab, collections, sidebarCollapsed } = useAppStore();

  if (sidebarCollapsed) return null;

  const navItems: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: "collections", icon: <FolderTree size={16} />, label: "Collections" },
    { id: "environments", icon: <Globe size={16} />, label: "Environments" },
    { id: "history", icon: <Clock size={16} />, label: "History" },
  ];

  return (
    <aside
      className="flex flex-col h-full border-r border-[var(--kp-border-primary)] bg-[var(--kp-bg-secondary)]"
      style={{ width: "var(--kp-sidebar-width)", minWidth: 220, maxWidth: 400 }}
    >
      {/* Workspace header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--kp-border-primary)]">
        <span className="text-sm font-semibold text-[var(--kp-text-primary)] truncate">
          My Workspace
        </span>
        <button className="p-1 rounded hover:bg-[var(--kp-bg-hover)] text-[var(--kp-text-secondary)]">
          <Plus size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--kp-text-muted)]"
          />
          <input
            type="text"
            placeholder="Search..."
            className="w-full h-7 pl-7 pr-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)]"
          />
        </div>
      </div>

      {/* Nav tabs */}
      <div className="flex px-3 gap-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setSidebarTab(item.id)}
            className={clsx(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors",
              sidebarTab === item.id
                ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
                : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-2 py-2">
        {sidebarTab === "collections" && <CollectionTree />}
        {sidebarTab === "environments" && <EnvironmentList />}
        {sidebarTab === "history" && <HistoryList />}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[var(--kp-border-primary)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[var(--kp-accent)] flex items-center justify-center text-white text-xs font-bold">
            K
          </div>
          <div>
            <div className="text-xs text-[var(--kp-text-primary)]">KnockPort</div>
            <div className="text-[10px] text-[var(--kp-text-muted)]">v0.1.0</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Collection Tree ──────────────────────────────────────────────────────────
function CollectionTree() {
  const { collections, openTab } = useAppStore();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!collections.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FolderTree size={24} className="text-[var(--kp-text-muted)] mb-2" />
        <p className="text-xs text-[var(--kp-text-tertiary)]">No collections yet</p>
        <p className="text-[10px] text-[var(--kp-text-muted)] mt-1">
          Create one to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {collections.map((collection) => (
        <div key={collection.id}>
          <button
            onClick={() => toggle(collection.id)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs text-[var(--kp-text-primary)] hover:bg-[var(--kp-bg-hover)] transition-colors"
          >
            {expanded.has(collection.id) ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            <Folder size={14} className="text-[var(--kp-accent)]" />
            <span className="truncate">{collection.name}</span>
          </button>

          {expanded.has(collection.id) && (
            <div className="ml-5 space-y-0.5">
              {collection.folders.map((folder) => (
                <div key={folder.id}>
                  <button
                    onClick={() => toggle(folder.id)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)] transition-colors"
                  >
                    {expanded.has(folder.id) ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <Folder size={12} className="text-[var(--kp-text-tertiary)]" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                </div>
              ))}
              {collection.requests.map((request) => (
                <button
                  key={request.id}
                  onClick={() => openTab(request)}
                  className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs hover:bg-[var(--kp-bg-hover)] transition-colors group"
                >
                  <File size={12} className="text-[var(--kp-text-muted)]" />
                  <span
                    className={clsx(
                      "text-[10px] font-bold w-10 shrink-0",
                      getMethodColor(request.method),
                    )}
                  >
                    {request.method}
                  </span>
                  <span className="truncate text-[var(--kp-text-secondary)] group-hover:text-[var(--kp-text-primary)]">
                    {request.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EnvironmentList() {
  const { environments, activeEnvironmentId, setActiveEnvironment } = useAppStore();

  if (!environments.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Globe size={24} className="text-[var(--kp-text-muted)] mb-2" />
        <p className="text-xs text-[var(--kp-text-tertiary)]">No environments</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {environments.map((env) => (
        <button
          key={env.id}
          onClick={() => setActiveEnvironment(env.id)}
          className={clsx(
            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
            activeEnvironmentId === env.id
              ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
              : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
          )}
        >
          <Globe size={12} />
          <span className="truncate">{env.name}</span>
          {env.isDefault && (
            <span className="ml-auto text-[10px] text-[var(--kp-text-muted)]">default</span>
          )}
        </button>
      ))}
    </div>
  );
}

function HistoryList() {
  const { history, openTab } = useAppStore();

  if (!history.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Clock size={24} className="text-[var(--kp-text-muted)] mb-2" />
        <p className="text-xs text-[var(--kp-text-tertiary)]">No history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {history.map((entry) => (
        <button
          key={entry.id}
          onClick={() => openTab(entry.request)}
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs hover:bg-[var(--kp-bg-hover)] transition-colors"
        >
          <span
            className={clsx(
              "text-[10px] font-bold w-10 shrink-0",
              getMethodColor(entry.request.method),
            )}
          >
            {entry.request.method}
          </span>
          <span className="truncate text-[var(--kp-text-secondary)]">{entry.request.url}</span>
          <span className="ml-auto text-[10px] text-[var(--kp-text-muted)] shrink-0">
            {formatTimeAgo(entry.timestamp)}
          </span>
        </button>
      ))}
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

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
