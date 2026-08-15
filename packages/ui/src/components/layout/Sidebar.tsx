import { useState } from "react";
import {
  LayoutDashboard,
  FolderClosed,
  Boxes,
  History as HistoryIcon,
  Plug,
  Server,
  Radio,
  Settings,
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  MoreHorizontal,
  Moon,
  Aperture,
} from "lucide-react";
import type { Collection, Folder, Request } from "@knockport/core";
import { useAppStore, type SidebarTab } from "../../store/app-store";

// ── Method color helper ──────────────────────────────────────────────────────
const methodColor: Record<string, string> = {
  GET: "var(--kp-method-get)",
  POST: "var(--kp-method-post)",
  PUT: "var(--kp-method-put)",
  PATCH: "var(--kp-method-patch)",
  DELETE: "var(--kp-method-delete)",
  HEAD: "var(--kp-method-head)",
  OPTIONS: "var(--kp-method-options)",
};

function MethodTag({ method }: { method: string }) {
  return (
    <span
      className="kp-method-tag"
      style={{ color: methodColor[method] ?? "var(--kp-text-secondary)" }}
    >
      {method === "DELETE" ? "DEL" : method}
    </span>
  );
}

// ── Nav items ────────────────────────────────────────────────────────────────
interface NavItem {
  id: SidebarTab | "placeholder" | "websocket";
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: "placeholder", label: "Dashboard", icon: LayoutDashboard },
  { id: "collections", label: "Collections", icon: FolderClosed },
  { id: "environments", label: "Environments", icon: Boxes },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "placeholder", label: "APIs", icon: Plug },
  { id: "placeholder", label: "Mock Servers", icon: Server },
  { id: "websocket", label: "WebSockets", icon: Radio },
  { id: "placeholder", label: "Settings", icon: Settings },
];

// ── Collection tree ──────────────────────────────────────────────────────────
function RequestRow({ request }: { request: Request }) {
  const openTab = useAppStore((s) => s.openTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const isActive = tabs.find((t) => t.id === activeTabId)?.requestId === request.id;

  return (
    <button
      type="button"
      className={`kp-tree-item kp-tree-request${isActive ? " active" : ""}`}
      onClick={() => openTab(request)}
    >
      <MethodTag method={request.method} />
      <span className="kp-truncate">{request.name}</span>
    </button>
  );
}

function FolderNode({ folder, depth }: { folder: Folder; depth: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        className="kp-tree-item kp-tree-folder"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="kp-truncate">{folder.name}</span>
      </button>
      {open && (
        <div>
          {folder.folders.map((f) => (
            <FolderNode key={f.id} folder={f} depth={depth + 1} />
          ))}
          {folder.requests.map((r) => (
            <div key={r.id} style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              <RequestRow request={r} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function countRequests(collection: Collection): number {
  const countFolder = (f: Folder): number =>
    f.requests.length + f.folders.reduce((acc, x) => acc + countFolder(x), 0);
  return collection.requests.length + collection.folders.reduce((acc, f) => acc + countFolder(f), 0);
}

function CollectionNode({ collection }: { collection: Collection }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className="kp-tree-item kp-tree-collection">
        <button type="button" className="kp-tree-toggle" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="kp-truncate" style={{ flex: 1 }}>{collection.name}</span>
        <span className="kp-count-badge">{countRequests(collection)}</span>
      </div>
      {open && (
        <div>
          {collection.folders.map((f) => (
            <FolderNode key={f.id} folder={f} depth={1} />
          ))}
          {collection.requests.map((r) => (
            <div key={r.id} style={{ paddingLeft: "14px" }}>
              <RequestRow request={r} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar() {
  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);
  const collections = useAppStore((s) => s.collections);
  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const history = useAppStore((s) => s.history);
  const openCommandPalette = useAppStore((s) => s.setCommandPaletteOpen);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setWebsocketOpen = useAppStore((s) => s.setWebsocketOpen);

  return (
    <aside className="kp-sidebar">
      {/* Logo */}
      <div className="kp-sidebar-logo">
        <span className="kp-logo-mark">
          <Aperture size={18} />
        </span>
        <span className="kp-logo-text">KnockPort</span>
      </div>

      {/* Workspace selector */}
      <button type="button" className="kp-workspace-btn">
        <Boxes size={15} />
        <span className="kp-truncate" style={{ flex: 1, textAlign: "left" }}>My Workspace</span>
        <ChevronDown size={14} />
      </button>

      {/* Search */}
      <button type="button" className="kp-search-btn" onClick={() => openCommandPalette(true)}>
        <Search size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Search</span>
        <span className="kp-kbd">⌘K</span>
      </button>

      {/* Nav */}
      <nav className="kp-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.id === sidebarTab;
          return (
            <button
              key={item.label}
              type="button"
              className={`kp-nav-item${active ? " active" : ""}`}
              onClick={() => {
                if (item.id === "websocket") setWebsocketOpen(true);
                else if (item.id !== "placeholder") setSidebarTab(item.id as SidebarTab);
              }}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Section */}
      <div className="kp-sidebar-section">
        <div className="kp-sidebar-section-header">
          <span>
            {sidebarTab === "collections" && "Collections"}
            {sidebarTab === "environments" && "Environments"}
            {sidebarTab === "history" && "History"}
          </span>
          <button type="button" className="kp-icon-btn" title="New">
            <Plus size={14} />
          </button>
        </div>

        <div className="kp-sidebar-tree kp-scroll">
          {sidebarTab === "collections" &&
            (collections.length === 0 ? (
              <div className="kp-empty-hint">No collections yet</div>
            ) : (
              collections.map((c) => <CollectionNode key={c.id} collection={c} />)
            ))}

          {sidebarTab === "environments" &&
            (environments.length === 0 ? (
              <div className="kp-empty-hint">No environments yet</div>
            ) : (
              environments.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`kp-tree-item${e.id === activeEnvironmentId ? " active" : ""}`}
                  onClick={() => setActiveEnvironment(e.id)}
                >
                  <span className="kp-truncate" style={{ flex: 1 }}>{e.name}</span>
                  {e.id === activeEnvironmentId && <span className="kp-active-dot" />}
                </button>
              ))
            ))}

          {sidebarTab === "history" &&
            (history.length === 0 ? (
              <div className="kp-empty-hint">No history yet</div>
            ) : (
              history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="kp-tree-item"
                  onClick={() => useAppStore.getState().openTab(h.request)}
                  title={h.request.url}
                >
                  <MethodTag method={h.request.method} />
                  <span className="kp-truncate kp-history-url">{h.request.url}</span>
                </button>
              ))
            ))}
        </div>
      </div>

      {/* User footer */}
      <div className="kp-user-footer">
        <div className="kp-avatar">AD</div>
        <div className="kp-user-info">
          <div className="kp-user-name">Arjun Dev</div>
          <div className="kp-user-email">arjun@transithq.dev</div>
        </div>
        <button type="button" className="kp-icon-btn" onClick={toggleTheme} title="Toggle theme">
          <Moon size={14} />
        </button>
      </div>

      {/* Status bar */}
      <div className="kp-status-bar">
        <span className="kp-status-online">
          <span className="kp-online-dot" /> Online
        </span>
        <span>v0.1.0</span>
        <button type="button" className="kp-link-btn">Feedback</button>
      </div>
    </aside>
  );
}
