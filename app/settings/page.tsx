"use client";

import { useEffect, useState } from "react";
import {
  MODE_STORAGE_KEY,
  PALETTE_LABELS,
  THEME_STORAGE_KEY,
  composeThemeId,
  normalizeStoredTheme,
  type ModeOption,
  type PaletteOption,
} from "../../lib/theme";

const MODES: ModeOption[] = ["dark", "light"];
const PALETTES: PaletteOption[] = ["green", "red", "blue", "mono"];

export default function SettingsPage() {
  const [mode, setMode] = useState<ModeOption>("dark");
  const [palette, setPalette] = useState<PaletteOption>("mono");
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    const resolved = normalizeStoredTheme(storedTheme, storedMode);
    setMode(resolved.mode);
    setPalette(resolved.palette);
    document.documentElement.setAttribute("data-theme", resolved.themeId);
    document.documentElement.setAttribute("data-mode", resolved.mode);
    window.localStorage.setItem(THEME_STORAGE_KEY, resolved.themeId);
    window.localStorage.setItem(MODE_STORAGE_KEY, resolved.mode);
  }, []);

  function applyTheme(nextPalette: PaletteOption, nextMode: ModeOption) {
    const nextThemeId = composeThemeId(nextPalette, nextMode);
    setPalette(nextPalette);
    setMode(nextMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeId);
    window.localStorage.setItem(MODE_STORAGE_KEY, nextMode);
    document.documentElement.setAttribute("data-theme", nextThemeId);
    document.documentElement.setAttribute("data-mode", nextMode);
    setAppliedNotice(`Applied ${nextMode} ${PALETTE_LABELS[nextPalette]}.`);

    window.setTimeout(() => {
      setAppliedNotice(null);
    }, 1400);
  }

  return (
    <main className="w-full p-6 md:p-8 space-y-6">
      <header className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-zinc-400">Choose mode and color style for your dashboard.</p>
      </header>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
        <h2 className="text-lg font-semibold">Appearance</h2>

        <div className="mt-4 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-400">Mode</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {MODES.map((option) => {
                const selected = option === mode;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => applyTheme(palette, option)}
                    className={`rounded border px-3 py-2 text-sm capitalize transition ${
                      selected
                        ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-700/80 bg-zinc-900/40 hover:bg-zinc-900/70"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-400">Color</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PALETTES.map((option) => {
                const selected = option === palette;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => applyTheme(option, mode)}
                    className={`rounded-lg border p-4 text-left transition active:scale-[0.99] ${
                      selected
                        ? "border-emerald-400/70 bg-emerald-500/10"
                        : "border-zinc-700/80 bg-zinc-900/40 hover:bg-zinc-900/70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{PALETTE_LABELS[option]}</p>
                      <span className={`h-2.5 w-2.5 rounded-full ${
                        option === "green"
                          ? "bg-emerald-400"
                          : option === "red"
                            ? "bg-rose-400"
                            : option === "blue"
                              ? "bg-sky-400"
                              : "bg-zinc-300"
                      }`} />
                    </div>
                    <p className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">
                      {mode}
                    </p>
                    {selected ? <p className="mt-1 text-xs text-emerald-300">Active color</p> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-zinc-400">
            Active selection: <span className="font-semibold text-zinc-200 capitalize">{mode}</span>{" "}
            <span className="font-semibold text-zinc-200">{PALETTE_LABELS[palette]}</span>
          </p>
          {appliedNotice ? <p className="text-xs text-emerald-300">{appliedNotice}</p> : null}
        </div>
      </section>
    </main>
  );
}
