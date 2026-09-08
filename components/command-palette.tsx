"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Languages, LogOut, Moon, Search, Sun, X, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { useTheme } from "@/lib/theme/client";
import { LANGUAGES, type Lang } from "@/lib/i18n/translations";
import { visibleNavGroups, type Role } from "@/lib/nav";
import { useShell } from "./shell-context";
import { applyLanguage } from "./language-switcher";
import { cn } from "@/lib/utils";
import { useModalFocus } from "@/lib/use-modal-focus";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useModalFocus({ open, onClose: () => setOpen(false), ref: dialogRef, initialFocusRef: inputRef });

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
    const terms = query.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return entries;
    return entries.filter((e) => {
      const hay = [e.label, e.section, e.hint ?? "", ...(e.keywords ?? [])].join(" ").normalize("NFKC").toLowerCase();
      return terms.every((term) => hay.includes(term));
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
      if (!open || document.activeElement !== inputRef.current) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.max(0, Math.min(filtered.length - 1, a + 1)));
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
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label={t("cmdk_title")}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[max(1rem,env(safe-area-inset-top))] sm:pt-[12dvh] px-3 sm:px-4 animate-fade-in outline-none"
    >
      <div className="backdrop" onClick={() => setOpen(false)} aria-hidden />
      <div className="relative w-full max-w-xl bg-surface-elevated border border-border-strong rounded-2xl shadow-overlay overflow-hidden animate-scale-in">
        <div className="flex min-h-16 items-center gap-3 pl-4 pr-2 border-b border-border">
          <Search className="w-5 h-5 shrink-0 text-accent" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t("cmdk_placeholder")}
            className="min-w-0 flex-1 h-12 bg-transparent outline-none text-[16px] sm:text-sm placeholder:text-text-muted"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-option-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            aria-label={t("cmdk_placeholder")}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("al_close")}
            title={t("al_close")}
            className="inline-flex shrink-0 w-11 h-11 items-center justify-center rounded-lg text-text-muted hover:bg-text-muted/[0.06] hover:text-text transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <ul ref={listRef} id={listId} className="max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain py-2" role="listbox" aria-label={t("cmdk_title")}>
          {filtered.length === 0 ? (
            <li role="presentation" className="px-6 py-12 text-center text-sm text-text-muted">
              <Search className="w-7 h-7 mx-auto mb-3 text-text-faint" aria-hidden />
              <span role="status">{t("cmdk_empty")}</span>
            </li>
          ) : (
            rows.map((row) => {
              if (row.type === "section") {
                return (
                  <li
                    key={`s:${row.label}`}
                    className="px-4 pt-3 pb-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-text-muted"
                    role="presentation"
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
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    setOpen(false);
                    entry.run();
                  }}
                  className={cn(
                    "mx-2 min-h-11 px-3 py-2.5 rounded-lg flex items-center gap-3 text-sm cursor-pointer transition-colors",
                    isActive ? "bg-accent/10 text-accent" : "text-text-soft hover:bg-text-muted/[0.04]",
                  )}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{entry.label}</span>
                  {isActive && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />}
                </li>
              );
            })
          )}
        </ul>
        <div className="hidden sm:flex px-4 py-3 border-t border-border items-center justify-between text-2xs text-text-muted">
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
