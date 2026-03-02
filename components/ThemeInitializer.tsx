"use client";

import { useEffect } from "react";
import { MODE_STORAGE_KEY, THEME_STORAGE_KEY, normalizeStoredTheme } from "../lib/theme";

export default function ThemeInitializer() {
  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    const resolved = normalizeStoredTheme(storedTheme, storedMode);

    document.documentElement.setAttribute("data-theme", resolved.themeId);
    document.documentElement.setAttribute("data-mode", resolved.mode);

    window.localStorage.setItem(THEME_STORAGE_KEY, resolved.themeId);
    window.localStorage.setItem(MODE_STORAGE_KEY, resolved.mode);
  }, []);

  return null;
}