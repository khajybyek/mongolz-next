"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Shared UI state for the authenticated app shell: the mobile navigation
 * drawer and the ⌘K command palette are opened from several places (header,
 * tab bar, keyboard) so their open flags live here instead of inside the
 * components that render them.
 */
interface ShellState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

const ShellContext = createContext<ShellState>({
  mobileNavOpen: false,
  setMobileNavOpen: () => undefined,
  paletteOpen: false,
  setPaletteOpen: () => undefined,
  togglePalette: () => undefined,
});

export function ShellProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, updateMobileNavOpen] = useState(false);
  const [paletteOpen, updatePaletteOpen] = useState(false);
  const setMobileNavOpen = useCallback((open: boolean) => {
    if (open) updatePaletteOpen(false);
    updateMobileNavOpen(open);
  }, []);
  const setPaletteOpen = useCallback((open: boolean) => {
    if (open) updateMobileNavOpen(false);
    updatePaletteOpen(open);
  }, []);
  const togglePalette = useCallback(() => {
    updateMobileNavOpen(false);
    updatePaletteOpen((p) => !p);
  }, []);

  const value = useMemo<ShellState>(
    () => ({ mobileNavOpen, setMobileNavOpen, paletteOpen, setPaletteOpen, togglePalette }),
    [mobileNavOpen, paletteOpen, setMobileNavOpen, setPaletteOpen, togglePalette],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}
