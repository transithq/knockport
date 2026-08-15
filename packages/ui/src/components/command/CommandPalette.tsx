import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { createId } from "@knockport/core";
import {
  Search,
  FilePlus,
  FolderPlus,
  Trash2,
  Moon,
  Sun,
  Download,
  Upload,
} from "lucide-react";

interface Command {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  group: string;
  action: () => void;
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const openTab = useAppStore((s) => s.openTab);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const clearHistory = useAppStore((s) => s.clearHistory);

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
          auth: { type: "none" },
          metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        });
        setCommandPaletteOpen(false);
      },
    },
    { id: "new-collection", label: "New Collection", icon: <FolderPlus size={14} />, group: "Actions", action: () => setCommandPaletteOpen(false) },
    { id: "toggle-theme", label: `Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`, icon: theme === "dark" ? <Sun size={14} /> : <Moon size={14} />, group: "Preferences", action: () => { toggleTheme(); setCommandPaletteOpen(false); } },
    { id: "clear-history", label: "Clear History", icon: <Trash2 size={14} />, group: "Actions", action: () => { clearHistory(); setCommandPaletteOpen(false); } },
    { id: "import-collection", label: "Import Collection", icon: <Download size={14} />, group: "Actions", action: () => setCommandPaletteOpen(false) },
    { id: "export-collection", label: "Export Collection", icon: <Upload size={14} />, group: "Actions", action: () => setCommandPaletteOpen(false) },
  ];

  const filtered = query ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : commands;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => setSelectedIndex(0), [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[selectedIndex]?.action(); }
    else if (e.key === "Escape") setCommandPaletteOpen(false);
  };

  const groups = new Map<string, Command[]>();
  for (const cmd of filtered) {
    const existing = groups.get(cmd.group) ?? [];
    existing.push(cmd);
    groups.set(cmd.group, existing);
  }
  let flatIndex = 0;

  return (
    <div className="kp-cmdk-overlay" onClick={() => setCommandPaletteOpen(false)}>
      <div className="kp-cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="kp-cmdk-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
          />
          <kbd>ESC</kbd>
        </div>
        <div className="kp-cmdk-results kp-scroll">
          {filtered.length === 0 && <div className="kp-cmdk-empty">No commands found</div>}
          {Array.from(groups.entries()).map(([group, cmds]) => (
            <div key={group}>
              <div className="kp-cmdk-group">{group}</div>
              {cmds.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`kp-cmdk-item${idx === selectedIndex ? " selected" : ""}`}
                  >
                    <span className="kp-cmdk-icon">{cmd.icon}</span>
                    <span className="kp-cmdk-label">{cmd.label}</span>
                    {cmd.shortcut && <span className="kp-cmdk-shortcut">{cmd.shortcut}</span>}
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
