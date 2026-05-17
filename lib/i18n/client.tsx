"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Lang, t as translate, type TranslationKey } from "./translations";

const LANG_COOKIE = "mongolz-lang";
const VALID: Lang[] = ["mn", "en", "kr"];

const LangContext = createContext<Lang>("mn");

function readCookieLang(): Lang {
  if (typeof document === "undefined") return "mn";
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`));
  const v = m?.[1] as Lang | undefined;
  return v && VALID.includes(v) ? v : "mn";
}

/**
 * Wraps client trees with the server-resolved language so client hooks
 * see the correct value on first render (avoids hydration mismatch).
 */
export function LangProvider({
  initial,
  children,
}: {
  initial: Lang;
  children: ReactNode;
}) {
  const [lang, setLang] = useState<Lang>(initial);
  useEffect(() => {
    const cookieLang = readCookieLang();
    if (cookieLang !== lang) setLang(cookieLang);
  }, [lang]);
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/**
 * Client-side translation hook. Reads the language from the
 * surrounding <LangProvider>. Falls back to "mn" if no provider.
 */
export function useT() {
  const lang = useContext(LangContext);
  return {
    lang,
    t: (key: TranslationKey) => translate(key, lang),
  };
}
