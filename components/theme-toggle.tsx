"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme/client";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg",
        "border border-border bg-surface-elevated text-text-soft",
        "hover:text-text hover:border-border-strong transition-colors",
        className,
      )}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
