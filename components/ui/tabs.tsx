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
    <div className={cn("tabs", className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
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
