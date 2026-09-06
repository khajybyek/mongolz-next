"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Languages, LogOut, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { useTheme } from "@/lib/theme/client";
import { LANGUAGES, type Lang } from "@/lib/i18n/translations";
import { visibleNavGroups, type Role } from "@/lib/nav";
import { useShell } from "./shell-context";
import { applyLanguage } from "./language-switcher";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  icon: LucideIcon;
  label: string;
  section: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export function CommandPalette({ role }: { role: Role }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { paletteOpen: open, setPaletteOpen: setOpen, togglePalette } = useShell();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const nav: Entry[] = visibleNavGroups(role).flatMap((group) =>
      group.items.map((item) => ({
        id: item.href,
        icon: item.icon,
        label: t(item.labelKey),
        section: t(group.labelKey),
        hint: item.href,
        keywords: item.keywords,
        run: () => router.push(item.href as never),
      })),
    );
    const actions: Entry[] = [
      {
        id: "action:theme",
        icon: theme === "dark" ? Sun : Moon,
        label: theme === "dark" ? t("theme_light") : t("theme_dark"),
        section: t("cmdk_section_actions"),
        keywords: ["theme", "dark", "light", "appearance"],
        run: toggleTheme,
      },
      ...(Object.keys(LANGUAGES) as Lang[])
        .filter((l) => l !== lang)
        .map<Entry>((l) => ({
          id: `action:lang:${l}`,
          icon: Languages,
          label: `${t("menu_language")}: ${LANGUAGES[l]}`,
          section: t("cmdk_section_actions"),
          keywords: ["language", l, LANGUAGES[l]],
          run: () => {
            void applyLanguage(l);
          },
        })),
      {
        id: "action:logout",
        icon: LogOut,
        label: t("logout"),
        section: t("cmdk_section_actions"),
        keywords: ["sign out", "logout"],
        run: () => {
          const form = document.createElement("form");
          form.method = "post";
          form.action = "/auth/logout";
          document.body.appendChild(form);
          form.submit();
        },
      },
    ];
    return [...nav, ...actions];
  }, [role, t, lang, theme, toggleTheme, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [e.label, e.section, e.hint ?? "", ...(e.keywords ?? [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(filtered.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = filtered[active];
        if (hit) {
          setOpen(false);
          hit.run();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, filtered, active, setOpen, togglePalette]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // Group consecutive entries by section for the header rows.
  const rows: Array<{ type: "section"; label: string } | { type: "entry"; entry: Entry; index: number }> = [];
  let lastSection: string | null = null;
  filtered.forEach((entry, index) => {
    if (entry.section !== lastSection) {
      rows.push({ type: "section", label: entry.section });
      lastSection = entry.section;
    }
    rows.push({ type: "entry", entry, index });
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("cmdk_title")}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] md:pt-[14vh] px-4 animate-fade-in"
    >
      <div className="backdrop" onClick={() => setOpen(false)} aria-hidden />
      <div className="relative w-full max-w-xl bg-surface-elevated border border-border-strong rounded-2xl shadow-overlay overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cmdk_placeholder")}
            className="flex-1 bg-transparent outline-none text-base md:text-sm placeholder:text-text-muted"
            aria-label={t("cmdk_placeholder")}
          />
          <kbd className="kbd">ESC</kbd>
        </div>
        <ul ref={listRef} className="max-h-[55vh] overflow-y-auto py-1.5" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-xs text-text-muted">{t("cmdk_empty")}</li>
          ) : (
            rows.map((row) => {
              if (row.type === "section") {
                return (
                  <li
                    key={`s:${row.label}`}
                    className="px-4 pt-2.5 pb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-text-faint"
                    aria-hidden
                  >
                    {row.label}
                  </li>
                );
              }
              const { entry, index } = row;
              const Icon = entry.icon;
              const isActive = index === active;
              return (
                <li
                  key={entry.id}
                  data-index={index}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    setOpen(false);
                    entry.run();
                  }}
                  className={cn(
                    "mx-1.5 px-2.5 py-2 rounded-lg flex items-center gap-3 text-sm cursor-pointer transition-colors",
                    isActive ? "bg-accent/10 text-accent" : "text-text-soft hover:bg-text-muted/[0.04]",
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{entry.label}</span>
                  {entry.hint && <code className="text-2xs text-text-faint font-mono hidden sm:inline">{entry.hint}</code>}
                </li>
              );
            })
          )}
        </ul>
        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-2xs text-text-muted">
          <span className="flex items-center gap-2">
            <kbd className="kbd">↑↓</kbd>
            {t("cmdk_navigate")}
            <kbd className="kbd ml-2">↵</kbd>
            {t("cmdk_open")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">⌘K</kbd>
            {t("cmdk_toggle")}
          </span>
        </div>
      </div>
    </div>
  );
}
