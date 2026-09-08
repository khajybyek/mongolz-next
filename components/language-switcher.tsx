"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { LANGUAGES, t, type Lang } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";

/**
 * Persist the language cookie server-side, then hard-reload. A plain
 * `router.refresh()` kept serving the RSC cache with the old cookie, so a
 * full reload is the only reliable way to re-render every server component.
 */
export async function applyLanguage(lang: Lang): Promise<boolean> {
  try {
    const res = await fetch("/api/lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang }),
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

interface Props {
  current: Lang;
  className?: string;
}

/** Segmented mn / en / kr control used on the public pages. */
export function LanguageSwitcher({ current, className }: Props) {
  const [pending, setPending] = useState(false);

  async function setLang(lang: Lang) {
    if (lang === current || pending) return;
    setPending(true);
    const ok = await applyLanguage(lang);
    if (!ok) setPending(false);
  }

  return (
    <div
      role="group"
      aria-label={t("language", current)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/60 p-0.5 text-xs",
        className,
      )}
    >
      <Languages className="w-3.5 h-3.5 text-text-muted hidden sm:inline ml-1.5 mr-0.5" aria-hidden />
      {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          disabled={pending}
          aria-pressed={l === current}
          className={cn(
            "min-w-11 min-h-11 px-2.5 rounded-md transition font-medium touch-manipulation select-none active:scale-95 disabled:opacity-60 disabled:cursor-wait",
            l === current
              ? "bg-accent/15 text-accent shadow-inner-soft"
              : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
          )}
          aria-label={`${t("lang_switch_to", current)} ${LANGUAGES[l]}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
