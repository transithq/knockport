import { useState } from "react";
import {
  LayoutDashboard,
  FolderClosed,
  FolderPlus,
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
  Trash2,
  Aperture,
} from "lucide-react";
import type { Collection, Folder, Request } from "@knockport/core";
import { createId } from "@knockport/core";
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
function RequestRow({ request, collectionId }: { request: Request; collectionId: string }) {
  const openTab = useAppStore((s) => s.openTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const deleteRequest = useAppStore((s) => s.deleteRequest);
  const isActive = tabs.find((t) => t.id === activeTabId)?.requestId === request.id;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`kp-tree-item kp-tree-request${isActive ? " active" : ""}`}
      onClick={() => openTab(request)}
      onKeyDown={(e) => e.key === "Enter" && openTab(request)}
    >
      <MethodTag method={request.method} />
      <span className="kp-truncate">{request.name}</span>
      <span className="kp-tree-actions">
        <button
          type="button"
          className="kp-icon-btn kp-danger"
          title="Delete request"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete request "${request.name}"?`)) deleteRequest(collectionId, request.id);
          }}
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function FolderNode({ folder, collectionId, depth }: { folder: Folder; collectionId: string; depth: number }) {
  const [open, setOpen] = useState(true);
  const addFolder = useAppStore((s) => s.addFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const addRequest = useAppStore((s) => s.addRequest);

  const newRequest = () => {
    const name = window.prompt("New request name", "New Request");
    if (name && name.trim()) {
      setOpen(true);
      addRequest(collectionId, folder.id, name.trim());
    }
  };
  const newFolder = () => {
    const name = window.prompt("New folder name", "New Folder");
    if (name && name.trim()) {
      setOpen(true);
      addFolder(collectionId, folder.id, name.trim());
    }
  };
  const rename = () => {
    const name = window.prompt("Rename folder", folder.name);
    if (name && name.trim()) renameFolder(collectionId, folder.id, name.trim());
  };
  const remove = () => {
    if (window.confirm(`Delete folder "${folder.name}" and everything inside?`)) deleteFolder(collectionId, folder.id);
  };

  return (
    <div>
      <div className="kp-tree-item kp-tree-folder" style={{ paddingLeft: `${12 + depth * 14}px` }}>
        <button type="button" className="kp-tree-toggle" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="kp-truncate" style={{ flex: 1 }}>{folder.name}</span>
        <span className="kp-tree-actions">
          <button type="button" className="kp-icon-btn" title="New request" onClick={newRequest}><Plus size={12} /></button>
          <button type="button" className="kp-icon-btn" title="New folder" onClick={newFolder}><FolderPlus size={12} /></button>
          <button type="button" className="kp-icon-btn" title="Rename" onClick={rename}><MoreHorizontal size={12} /></button>
          <button type="button" className="kp-icon-btn kp-danger" title="Delete" onClick={remove}><Trash2 size={12} /></button>
        </span>
      </div>
      {open && (
        <div>
          {folder.folders.map((f) => (
            <FolderNode key={f.id} folder={f} collectionId={collectionId} depth={depth + 1} />
          ))}
          {folder.requests.map((r) => (
            <div key={r.id} style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              <RequestRow request={r} collectionId={collectionId} />
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
  const updateCollection = useAppStore((s) => s.updateCollection);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const addFolder = useAppStore((s) => s.addFolder);
  const addRequest = useAppStore((s) => s.addRequest);
  const openCollectionTab = useAppStore((s) => s.openCollectionTab);

  const rename = () => {
    const name = window.prompt("Rename collection", collection.name);
    if (name && name.trim()) updateCollection(collection.id, { name: name.trim() });
  };
  const remove = () => {
    if (window.confirm(`Delete collection "${collection.name}"?`)) deleteCollection(collection.id);
  };
  const newRequest = () => {
    const name = window.prompt("New request name", "New Request");
    if (name && name.trim()) {
      setOpen(true);
      addRequest(collection.id, null, name.trim());
    }
  };
  const newFolder = () => {
    const name = window.prompt("New folder name", "New Folder");
    if (name && name.trim()) {
      setOpen(true);
      addFolder(collection.id, null, name.trim());
    }
  };

  return (
    <div>
      <div className="kp-tree-item kp-tree-collection">
        <button type="button" className="kp-tree-toggle" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button type="button" className="kp-tree-label" style={{ flex: 1 }} title="Open collection" onClick={() => openCollectionTab(collection.id)}>
          <span className="kp-truncate">{collection.name}</span>
        </button>
        <span className="kp-count-badge">{countRequests(collection)}</span>
        <span className="kp-tree-actions">
          <button type="button" className="kp-icon-btn" title="New request" onClick={newRequest}><Plus size={12} /></button>
          <button type="button" className="kp-icon-btn" title="New folder" onClick={newFolder}><FolderPlus size={12} /></button>
          <button type="button" className="kp-icon-btn" title="Rename" onClick={rename}><MoreHorizontal size={12} /></button>
          <button type="button" className="kp-icon-btn kp-danger" title="Delete" onClick={remove}><Trash2 size={12} /></button>
        </span>
      </div>
      {open && (
        <div>
          {collection.folders.map((f) => (
            <FolderNode key={f.id} folder={f} collectionId={collection.id} depth={1} />
          ))}
          {collection.requests.map((r) => (
            <div key={r.id} style={{ paddingLeft: "14px" }}>
              <RequestRow request={r} collectionId={collection.id} />
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
  const addCollection = useAppStore((s) => s.addCollection);
  const addEnvironment = useAppStore((s) => s.addEnvironment);

  const createNew = () => {
    if (sidebarTab === "collections") {
      const name = window.prompt("New collection name", "New Collection");
      if (!name || !name.trim()) return;
      addCollection({
        id: createId("col"),
        name: name.trim(),
        variables: [],
        folders: [],
        requests: [],
        order: [],
        auth: { type: "none" },
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
    } else if (sidebarTab === "environments") {
      const name = window.prompt("New environment name", "New Environment");
      if (!name || !name.trim()) return;
      addEnvironment({ id: createId("env"), name: name.trim(), variables: [] });
    }
  };

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
          <button type="button" className="kp-icon-btn" title="New" onClick={createNew}>
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
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  className={`kp-tree-item${e.id === activeEnvironmentId ? " active" : ""}`}
                  onClick={() => setActiveEnvironment(e.id)}
                  onKeyDown={(ev) => ev.key === "Enter" && setActiveEnvironment(e.id)}
                >
                  <span className="kp-truncate" style={{ flex: 1 }}>{e.name}</span>
                  {e.id === activeEnvironmentId && <span className="kp-active-dot" />}
                  <span className="kp-tree-actions">
                    <button
                      type="button"
                      className="kp-icon-btn"
                      title="Edit variables"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        useAppStore.getState().openEnvironmentTab(e.id);
                      }}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    <button
                      type="button"
                      className="kp-icon-btn kp-danger"
                      title="Delete environment"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (window.confirm(`Delete environment "${e.name}"?`)) {
                          useAppStore.getState().deleteEnvironment(e.id);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
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
