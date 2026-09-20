import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const storageKey = "declick-theme";

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function setDocumentTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#121212" : "#eef1ed");
  window.dispatchEvent(new Event("declickthemechange"));
}

export function useTheme() {
  const [preference, setPreference] = useState<Theme | null>(savedTheme);
  const [systemDark, setSystemDark] = useState(prefersDark);
  const theme = preference ?? (systemDark ? "dark" : "light");

  useEffect(() => {
    setDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The theme still works for this session when storage is unavailable.
    }
  };

  return { theme, toggleTheme };
}
