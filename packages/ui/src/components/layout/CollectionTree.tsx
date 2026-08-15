import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import type { Collection } from "@knockport/core";
import { useAppStore } from "../../store/app-store";
import { flattenTree, countRequests, type TreeRow } from "./tree-model";

const ROW_HEIGHT = 33;
const OVERSCAN = 12;

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

// ── Row renderers ────────────────────────────────────────────────────────────
interface RowProps {
  row: TreeRow;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}

function CollectionRow({ row, collapsed, onToggle }: RowProps) {
  const node = row as Extract<TreeRow, { kind: "collection" }>;
  const { collection } = node;
  const updateCollection = useAppStore((s) => s.updateCollection);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const addFolder = useAppStore((s) => s.addFolder);
  const addRequest = useAppStore((s) => s.addRequest);
  const openCollectionTab = useAppStore((s) => s.openCollectionTab);
  const diskRoot = useAppStore((s) => s.diskRoots[collection.id]);
  const open = !collapsed.has(collection.id);

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
      if (!open) onToggle(collection.id);
      addRequest(collection.id, null, name.trim());
    }
  };
  const newFolder = () => {
    const name = window.prompt("New folder name", "New Folder");
    if (name && name.trim()) {
      if (!open) onToggle(collection.id);
      addFolder(collection.id, null, name.trim());
    }
  };

  return (
    <div className="kp-tree-item kp-tree-collection">
      <button type="button" className="kp-tree-toggle" onClick={() => onToggle(collection.id)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <button
        type="button"
        className="kp-tree-label"
        style={{ flex: 1 }}
        title="Open collection"
        onClick={() => openCollectionTab(collection.id)}
      >
        <span className="kp-truncate">{collection.name}</span>
      </button>
      {diskRoot && (
        <span className="kp-disk-badge" title={`Disk-backed: ${diskRoot}`}>
          <FolderOpen size={11} />
        </span>
      )}
      <span className="kp-count-badge">{countRequests(collection)}</span>
      <span className="kp-tree-actions">
        <button type="button" className="kp-icon-btn" title="New request" onClick={newRequest}>
          <Plus size={12} />
        </button>
        <button type="button" className="kp-icon-btn" title="New folder" onClick={newFolder}>
          <FolderPlus size={12} />
        </button>
        <button type="button" className="kp-icon-btn" title="Rename" onClick={rename}>
          <MoreHorizontal size={12} />
        </button>
        <button type="button" className="kp-icon-btn kp-danger" title="Delete" onClick={remove}>
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function FolderRow({ row, collapsed, onToggle }: RowProps) {
  const node = row as Extract<TreeRow, { kind: "folder" }>;
  const { folder, collectionId, depth } = node;
  const addFolder = useAppStore((s) => s.addFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const addRequest = useAppStore((s) => s.addRequest);
  const open = !collapsed.has(folder.id);

  const newRequest = () => {
    const name = window.prompt("New request name", "New Request");
    if (name && name.trim()) {
      if (!open) onToggle(folder.id);
      addRequest(collectionId, folder.id, name.trim());
    }
  };
  const newFolder = () => {
    const name = window.prompt("New folder name", "New Folder");
    if (name && name.trim()) {
      if (!open) onToggle(folder.id);
      addFolder(collectionId, folder.id, name.trim());
    }
  };
  const rename = () => {
    const name = window.prompt("Rename folder", folder.name);
    if (name && name.trim()) renameFolder(collectionId, folder.id, name.trim());
  };
  const remove = () => {
    if (window.confirm(`Delete folder "${folder.name}" and everything inside?`)) {
      deleteFolder(collectionId, folder.id);
    }
  };

  return (
    <div className="kp-tree-item kp-tree-folder" style={{ paddingLeft: `${12 + depth * 14}px` }}>
      <button type="button" className="kp-tree-toggle" onClick={() => onToggle(folder.id)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <span className="kp-truncate" style={{ flex: 1 }}>{folder.name}</span>
      <span className="kp-tree-actions">
        <button type="button" className="kp-icon-btn" title="New request" onClick={newRequest}>
          <Plus size={12} />
        </button>
        <button type="button" className="kp-icon-btn" title="New folder" onClick={newFolder}>
          <FolderPlus size={12} />
        </button>
        <button type="button" className="kp-icon-btn" title="Rename" onClick={rename}>
          <MoreHorizontal size={12} />
        </button>
        <button type="button" className="kp-icon-btn kp-danger" title="Delete" onClick={remove}>
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function RequestRow({ row }: RowProps) {
  const node = row as Extract<TreeRow, { kind: "request" }>;
  const { request, collectionId, depth } = node;
  const openTab = useAppStore((s) => s.openTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const deleteRequest = useAppStore((s) => s.deleteRequest);
  const isActive = tabs.find((t) => t.id === activeTabId)?.requestId === request.id;

  return (
    <div style={{ paddingLeft: `${depth * 14}px` }}>
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
              if (window.confirm(`Delete request "${request.name}"?`)) {
                deleteRequest(collectionId, request.id);
              }
            }}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>
    </div>
  );
}

// ── Virtualized collection tree ──────────────────────────────────────────────
/**
 * Renders the whole collection forest inside a single virtualized list so
 * large collections (target: 50 000 requests) stay fast. Only the visible
 * slice of rows is mounted; expand/collapse recomputes the flat row list.
 */
export function CollectionTree({ collections }: { collections: Collection[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const collapsedNodes = useAppStore((s) => s.collapsedNodes);
  const toggleNode = useAppStore((s) => s.toggleNode);

  const collapsed = useMemo(() => new Set(collapsedNodes), [collapsedNodes]);
  const rows = useMemo(() => flattenTree(collections, collapsed), [collections, collapsed]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div ref={containerRef} className="kp-sidebar-tree kp-scroll">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={row.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              {row.kind === "collection" && <CollectionRow row={row} collapsed={collapsed} onToggle={toggleNode} />}
              {row.kind === "folder" && <FolderRow row={row} collapsed={collapsed} onToggle={toggleNode} />}
              {row.kind === "request" && <RequestRow row={row} collapsed={collapsed} onToggle={toggleNode} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
