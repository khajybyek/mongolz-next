"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { LANGUAGES, type Lang } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";

interface Props {
  current: Lang;
}

export function LanguageSwitcher({ current }: Props) {
  const [pending, setPending] = useState(false);

  async function setLang(lang: Lang) {
    if (lang === current || pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/lang", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Lang switch failed");
      // Hard reload — Next.js router.refresh() RSC cache-аас уншсан хэвээр
      // байгаад server cookie шинэ утгыг авч чадахгүй байх. window.reload-ээр
      // бүх cache-ийг шинэчилнэ.
      window.location.reload();
    } catch {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <Languages className="w-3.5 h-3.5 text-text-muted hidden sm:inline" />
      {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          disabled={pending}
          className={cn(
            "min-w-[44px] min-h-[36px] px-3 py-1.5 rounded-md transition font-medium",
            "touch-manipulation select-none",
            "active:scale-95",
            l === current
              ? "bg-accent/15 text-accent"
              : "text-text-soft hover:bg-white/5 hover:text-text"
          )}
          aria-label={`Switch to ${l.toUpperCase()}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
