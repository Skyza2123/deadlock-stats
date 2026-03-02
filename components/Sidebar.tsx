"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  composeThemeId,
  normalizeStoredTheme,
  type ModeOption,
  type PaletteOption,
} from "../lib/theme";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/teams", label: "Teams" },
  { href: "/players", label: "Players" },
  { href: "/account", label: "Account" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ModeOption>("dark");
  const [palette, setPalette] = useState<PaletteOption>("mono");

  useEffect(() => {
    const saved = window.localStorage.getItem("sidebar-collapsed");
    if (saved === "1") setCollapsed(true);

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    const resolved = normalizeStoredTheme(storedTheme, storedMode);
    setMode(resolved.mode);
    setPalette(resolved.palette);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  function toggleMode() {
    const nextMode: ModeOption = mode === "dark" ? "light" : "dark";
    const nextThemeId = composeThemeId(palette, nextMode);
    setMode(nextMode);
    window.localStorage.setItem(MODE_STORAGE_KEY, nextMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeId);
    document.documentElement.setAttribute("data-mode", nextMode);
    document.documentElement.setAttribute("data-theme", nextThemeId);
  }

  return (
    <>
      <nav className="sidebar-mobile md:hidden fixed bottom-0 inset-x-0 z-40">
        <div className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {NAV.filter((n) => (session ? true : n.href !== "/teams")).map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={`mobile-${n.href}`}
                href={n.href}
                className={[
                  "flex h-11 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors",
                  active
                    ? "sidebar-link-active border"
                    : "sidebar-link-idle hover:text-inherit",
                ].join(" ")}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <aside
      className={[
        "sidebar-shell hidden md:block shrink-0 transition-all duration-200",
        collapsed ? "w-16" : "w-72",
      ].join(" ")}
    >
      <div className="sticky top-0 h-screen flex flex-col">
        {/* Header */}
        <div className="sidebar-header p-3">
          <div className="flex items-center justify-between gap-2">
            <div className={collapsed ? "hidden" : "block"}>
              <div className="heading-luxe text-lg font-semibold tracking-tight">Deadlock Stats</div>
              <div className="sidebar-muted mt-0.5 text-[11px]">Scrim analytics workspace</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleMode}
                className={[
                  "sidebar-btn rounded text-xs transition active:scale-95",
                  collapsed ? "h-8 w-8" : "px-2 py-1.5",
                ].join(" ")}
                title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {mode === "dark" ? "☀" : "☾"}
              </button>
              <button
                onClick={() => setCollapsed((v) => !v)}
                className={[
                  "sidebar-btn rounded text-xs transition active:scale-95",
                  collapsed ? "h-8 w-8" : "px-2 py-1.5",
                ].join(" ")}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? "→" : "←"}
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className={collapsed ? "p-2 space-y-1.5" : "p-3 space-y-2"}>
          <div
            className={[
              "sidebar-muted px-2 pt-1 pb-1 text-xs font-medium uppercase tracking-wide",
              collapsed ? "hidden" : "block",
            ].join(" ")}
          >
            Navigation
          </div>

          {NAV.filter((n) => (session ? true : n.href !== "/teams")).map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={collapsed ? n.label : undefined}
                className={[
                  "group flex items-center gap-2 rounded-lg border text-sm transition-all duration-150 active:scale-[0.99]",
                  collapsed ? "justify-center" : "",
                  collapsed ? "h-11 px-2" : "h-11 px-3",
                  active ? "sidebar-link-active shadow-sm" : "sidebar-link-idle",
                ].join(" ")}
              >
                <span
                  className={[
                    "rounded-full transition-colors",
                    active ? "bg-zinc-300 dark:bg-zinc-300" : "bg-zinc-500 opacity-70 dark:bg-zinc-500",
                    collapsed ? "h-2.5 w-2.5" : "h-2 w-2",
                  ].join(" ")}
                />
                {collapsed ? null : n.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className={[
            "sidebar-footer sidebar-muted mt-auto p-3 text-xs leading-relaxed",
            collapsed ? "hidden" : "block",
          ].join(" ")}
        >
          {status === "loading" ? (
            <div className="panel-premium-soft sidebar-muted mb-3 w-full rounded px-3 py-2 text-sm">
              Checking login...
            </div>
          ) : session ? (
            <>
              <div className="mb-2 flex items-center gap-2 min-w-0">
                {session.user?.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user?.name ?? "user"}
                    className="h-6 w-6 rounded-full border border-zinc-600/70"
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="sidebar-strong truncate text-xs">{session.user?.name ?? "Signed in"}</div>
                  <div className="sidebar-muted truncate text-[11px]">{session.user?.email ?? "Steam account"}</div>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="sidebar-btn mb-3 w-full rounded px-3 py-2 text-left text-sm"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="sidebar-btn mb-3 block w-full rounded px-3 py-2 text-left text-sm"
            >
              Sign in
            </Link>
          )}
          <div className="opacity-80">Tip:</div>
          <div>Use Teams to map SteamIDs to scrim rosters.</div>
        </div>
      </div>
      </aside>
    </>
  );
}