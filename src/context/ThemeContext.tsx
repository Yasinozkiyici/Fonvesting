"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

function applyThemeToDocument(next: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = next === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private / disabled storage */
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const bootstrapped = useRef(false);
  /** Strict Mode’da ikinci effect çağrısında closure’daki `theme` eski kalabiliyor; DOM senkronu için güncel değer. */
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;

  /**
   * İlk çalıştırma: localStorage → state + DOM.
   * Sonrakiler: `theme` değişince DOM + persist (iki ayrı effect’in birbirini ezmesini önler).
   */
  useEffect(() => {
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      const raw = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const t: Theme = raw === "dark" || raw === "light" ? raw : "light";
      setThemeState(t);
      themeRef.current = t;
      applyThemeToDocument(t);
      return;
    }
    applyThemeToDocument(themeRef.current);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    if (next !== "light" && next !== "dark") return;
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme,
      setTheme,
    }),
    [theme, toggleTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
