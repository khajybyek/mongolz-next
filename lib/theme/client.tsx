"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

const COOKIE = "mongolz-theme";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}>({
  theme: "dark",
  setTheme: () => undefined,
  toggleTheme: () => undefined,
});

function applyThemeAttr(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
}

function readCookieTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  const v = m?.[1] as Theme | undefined;
  return v === "light" || v === "dark" ? v : "dark";
}

function writeCookieTheme(t: Theme) {
  if (typeof document === "undefined") return;
  // 1-year persistence, SameSite=Lax (purely UI prefs, no auth value)
  document.cookie = `${COOKIE}=${t}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/**
 * Wrap client trees with the server-resolved theme so the first render
 * matches what the user last picked (no FOUC).
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  // Sync with the cookie on mount (in case it changed between server render
  // and hydration, e.g. another tab toggled it).
  useEffect(() => {
    const cookieTheme = readCookieTheme();
    if (cookieTheme !== theme) {
      setThemeState(cookieTheme);
      applyThemeAttr(cookieTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeCookieTheme(t);
    applyThemeAttr(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
