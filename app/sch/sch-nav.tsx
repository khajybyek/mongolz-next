"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Gamepad2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-tab nav for the public pages. A segmented control so the current page
 * is visible at a glance; centred on phones (its own row under the mark),
 * inline between the mark and the controls from `sm` up.
 */
export function SchNav({ register, teams, label }: { register: string; teams: string; label: string }) {
  const pathname = usePathname();
  const items = [
    { href: "/sch" as Route, text: register, icon: Gamepad2, active: pathname === "/sch" },
    { href: "/sch/teams" as Route, text: teams, icon: Users, active: pathname.startsWith("/sch/teams") },
  ];
  return (
    <nav aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/60 p-0.5 text-sm">
      {items.map(({ href, text, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 font-medium transition touch-manipulation",
            active ? "bg-accent/15 text-accent shadow-inner-soft" : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {text}
        </Link>
      ))}
    </nav>
  );
}
