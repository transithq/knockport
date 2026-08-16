import { clsx } from "clsx";
import { useMemo, useState } from "react";

// ── Tab-completion input ─────────────────────────────────────────────────────
// A controlled text input with a lightweight suggestion dropdown: suggestions
// appear while typing, Tab (or Enter) accepts the highlighted one, arrows
// move, Escape closes. Parent stays in control — every keystroke goes through
// onChange (draft handling), and onCommit fires on blur for parse-and-store.

export interface Suggestion {
  label: string;
  insert: string;
  hint?: string;
}

export function SuggestInput({
  value,
  onChange,
  onCommit,
  onEnter,
  suggestions,
  className,
  placeholder,
  disabled,
  title,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fires on blur with the final value (parse/commit hook). */
  onCommit?: (value: string) => void;
  /** Fires on Enter when no suggestion is highlighted. */
  onEnter?: () => void;
  suggestions: (value: string) => Suggestion[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  type?: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const items = useMemo(
    () => (open ? suggestions(value).slice(0, 6) : []),
    [open, suggestions, value],
  );

  const accept = (item: Suggestion | undefined) => {
    if (!item) return;
    onChange(item.insert);
    setOpen(false);
    setIndex(0);
  };

  return (
    <div className="kp-suggest-wrap">
      <input
        type={type}
        className={clsx("kp-suggest-input", className)}
        value={value}
        title={title}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setIndex(0);
        }}
        onFocus={() => {
          setOpen(true);
          setIndex(0);
        }}
        onBlur={() => {
          setOpen(false);
          onCommit?.(value);
        }}
        onKeyDown={(e) => {
          if (items.length > 0 && open) {
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              accept(items[index]);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              accept(items[index]);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => (i + 1) % items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i - 1 + items.length) % items.length);
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
      />
      {open && items.length > 0 && (
        <div className="kp-suggest-list" onMouseDown={(e) => e.preventDefault()}>
          {items.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              type="button"
              className={clsx("kp-suggest-item", i === index && "active")}
              onMouseEnter={() => setIndex(i)}
              onClick={() => accept(item)}
            >
              <span className="kp-mono kp-truncate">{item.label}</span>
              {item.hint && <span className="kp-suggest-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
