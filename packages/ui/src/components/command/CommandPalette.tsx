import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { createId } from "@knockport/core";
import {
  Search,
  FilePlus,
  FolderPlus,
  Trash2,
  Moon,
  Sun,
  History,
  Download,
  Upload,
  Settings,
} from "lucide-react";

// ── Command definition ───────────────────────────────────────────────────────
interface Command {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  group: string;
  action: () => void;
}

// ── CommandPalette ───────────────────────────────────────────────────────────
export function CommandPalette() {
  const {
    setCommandPaletteOpen,
    openTab,
    toggleTheme,
    theme,
    clearHistory,
  } = useAppStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands: Command[] = [
    {
      id: "new-request",
      label: "New Request",
      icon: <FilePlus size={14} />,
      shortcut: "Ctrl+N",
      group: "Actions",
      action: () => {
        openTab({
          id: `req_${createId()}`,
          name: "Untitled Request",
          method: "GET",
          url: "",
          headers: [],
          params: [],
          body: { type: "none" },
          auth: { type: "inherit" },
          metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        });
        setCommandPaletteOpen(false);
      },
    },
    {
      id: "new-collection",
      label: "New Collection",
      icon: <FolderPlus size={14} />,
      group: "Actions",
      action: () => {
        // TODO: implement collection creation
        setCommandPaletteOpen(false);
      },
    },
    {
      id: "toggle-theme",
      label: `Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`,
      icon: theme === "dark" ? <Sun size={14} /> : <Moon size={14} />,
      group: "Preferences",
      action: () => {
        toggleTheme();
        setCommandPaletteOpen(false);
      },
    },
    {
      id: "clear-history",
      label: "Clear History",
      icon: <Trash2 size={14} />,
      group: "Actions",
      action: () => {
        clearHistory();
        setCommandPaletteOpen(false);
      },
    },
    {
      id: "import-collection",
      label: "Import Collection",
      icon: <Download size={14} />,
      group: "Actions",
      action: () => {
        setCommandPaletteOpen(false);
      },
    },
    {
      id: "export-collection",
      label: "Export Collection",
      icon: <Upload size={14} />,
      group: "Actions",
      action: () => {
        setCommandPaletteOpen(false);
      },
    },
  ];

  // Filter commands by query
  const filtered = query
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selectedIndex]?.action();
    } else if (e.key === "Escape") {
      setCommandPaletteOpen(false);
    }
  };

  // Group commands
  const groups = new Map<string, Command[]>();
  for (const cmd of filtered) {
    const existing = groups.get(cmd.group) ?? [];
    existing.push(cmd);
    groups.set(cmd.group, existing);
  }

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setCommandPaletteOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg bg-[var(--kp-bg-secondary)] border border-[var(--kp-border-primary)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 border-b border-[var(--kp-border-primary)]">
          <Search size={16} className="text-[var(--kp-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="w-full h-12 bg-transparent text-sm text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] text-[10px] text-[var(--kp-text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--kp-text-muted)]">
              No commands found
            </div>
          )}

          {Array.from(groups.entries()).map(([group, cmds]) => (
            <div key={group}>
              <div className="px-2 py-1 text-[10px] font-medium text-[var(--kp-text-muted)] uppercase tracking-wider">
                {group}
              </div>
              {cmds.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={cmd.id}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={
                      idx === selectedIndex
                        ? "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm bg-[var(--kp-accent-muted)] text-[var(--kp-text-primary)]"
                        : "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]"
                    }
                  >
                    <span className="text-[var(--kp-text-muted)]">{cmd.icon}</span>
                    <span className="flex-1 text-left">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="text-[10px] text-[var(--kp-text-muted)]">{cmd.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
