"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  value: string;
  label: ReactNode;
  badge?: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={cn("tabs", className)} role="tablist"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0 || !buttons.length) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        if (tabs[next]) onChange(tabs[next].value);
      }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || !tabs.some((item) => item.value === value) && tab === tabs[0] ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn("tab inline-flex items-center gap-2", active && "tab-active")}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
