import type { ReactNode } from "react";
import { clsx } from "clsx";
import { useRef, useState } from "react";

// ── Dropdown menu ────────────────────────────────────────────────────────────
// Small shared popover for the "⋯"/caret CTAs. Closes on outside click, on
// item activation, and on Escape; focus stays inside so onBlur closing works
// with keyboard navigation.

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export function DropdownMenu({
  buttonLabel,
  buttonClassName,
  buttonTitle,
  items,
  disabled,
}: {
  buttonLabel: ReactNode;
  buttonClassName: string;
  buttonTitle?: string;
  items: MenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="kp-menu-wrap" ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        title={buttonTitle}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!ref.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {buttonLabel}
      </button>
      {open && (
        <div className="kp-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="kp-menu-item"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// clsx import kept for consumers that pass conditional button classes.
export const menuClass = (active: boolean) => clsx(active && "active");
