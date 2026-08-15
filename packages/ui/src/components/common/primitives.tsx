import React from "react";
import { clsx } from "clsx";

// ── Button ───────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--kp-border-focus)] disabled:opacity-50 disabled:pointer-events-none";

  const variants = {
    primary:
      "bg-[var(--kp-accent)] hover:bg-[var(--kp-accent-hover)] text-white",
    secondary:
      "bg-[var(--kp-bg-tertiary)] hover:bg-[var(--kp-bg-hover)] text-[var(--kp-text-primary)] border border-[var(--kp-border-primary)]",
    ghost:
      "bg-transparent hover:bg-[var(--kp-bg-hover)] text-[var(--kp-text-secondary)]",
    danger:
      "bg-[var(--kp-error)] hover:bg-[var(--kp-error)]/90 text-white",
  };

  const sizes = {
    sm: "h-7 px-2 text-xs",
    md: "h-8 px-3 text-sm",
    lg: "h-10 px-4 text-sm",
  };

  return (
    <button className={clsx(base, variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

// ── Input ────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export function Input({ icon, className, ...props }: InputProps) {
  return (
    <div className="relative flex items-center">
      {icon && (
        <span className="absolute left-2.5 text-[var(--kp-text-tertiary)] pointer-events-none">
          {icon}
        </span>
      )}
      <input
        className={clsx(
          "w-full h-8 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-sm text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)] transition-colors",
          icon ? "pl-8 pr-3" : "px-3",
          className,
        )}
        {...props}
      />
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  const variants = {
    default: "bg-[var(--kp-bg-elevated)] text-[var(--kp-text-secondary)]",
    success: "bg-[var(--kp-success-bg)] text-[var(--kp-success)]",
    warning: "bg-[var(--kp-warning-bg)] text-[var(--kp-warning)]",
    error: "bg-[var(--kp-error-bg)] text-[var(--kp-error)]",
    info: "bg-[var(--kp-info-bg)] text-[var(--kp-info)]",
  };

  return (
    <span
      className={clsx(
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
interface TabsProps {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={clsx("flex items-center gap-0.5 border-b border-[var(--kp-border-primary)]", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            "px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
            active === tab.id
              ? "text-[var(--kp-accent)] border-[var(--kp-accent)]"
              : "text-[var(--kp-text-secondary)] border-transparent hover:text-[var(--kp-text-primary)] hover:border-[var(--kp-border-secondary)]",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 text-[10px] text-[var(--kp-text-muted)]">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Icon button ──────────────────────────────────────────────────────────────
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  tooltip?: string;
  size?: "sm" | "md";
}

export function IconButton({ icon, tooltip, size = "md", className, ...props }: IconButtonProps) {
  const sizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
  };

  return (
    <button
      title={tooltip}
      className={clsx(
        "inline-flex items-center justify-center rounded-md text-[var(--kp-text-secondary)] hover:text-[var(--kp-text-primary)] hover:bg-[var(--kp-bg-hover)] transition-colors",
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
      {icon && (
        <div className="text-[var(--kp-text-muted)] [&>svg]:w-10 [&>svg]:h-10">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium text-[var(--kp-text-secondary)]">{title}</h3>
      {description && (
        <p className="text-xs text-[var(--kp-text-tertiary)] max-w-xs">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
