"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  { href: "/scrims", label: "Scrims" },
  { href: "/teams", label: "Teams" },
  { href: "/matches", label: "Matches" },
  { href: "/players", label: "Players" },
  { href: "/account", label: "Account" },
  { href: "/settings", label: "Settings" },
];

type TeamOption = {
  slug: string;
  name: string;
};

type TeamsApiResponse = {
  ok?: boolean;
  teams?: Array<{ slug?: unknown; name?: unknown }>;
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ModeOption>("dark");
  const [palette, setPalette] = useState<PaletteOption>("mono");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeamSlug, setSelectedTeamSlug] = useState("");

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

  useEffect(() => {
    const savedTeamSlug = window.localStorage.getItem("sidebar-team-slug") ?? "";
    setSelectedTeamSlug(savedTeamSlug);
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadTeams() {
      if (!session) {
        if (!alive) return;
        setTeams([]);
        setTeamsLoading(false);
        return;
      }

      setTeamsLoading(true);
      try {
        const res = await fetch("/api/teams", { cache: "no-store" });
        const data: TeamsApiResponse | null = await res.json().catch(() => null);

        if (!alive) return;
        if (!res.ok || !data?.ok || !Array.isArray(data?.teams)) {
          setTeams([]);
          return;
        }

        const nextTeams = data.teams
          .map((row) => ({
            slug: String(row?.slug ?? "").trim(),
            name: String(row?.name ?? row?.slug ?? "").trim(),
          }))
          .filter((row: TeamOption) => row.slug);

        setTeams(nextTeams);

        if (!nextTeams.some((row: TeamOption) => row.slug === selectedTeamSlug)) {
          setSelectedTeamSlug("");
          window.localStorage.removeItem("sidebar-team-slug");
        }
      } catch {
        if (!alive) return;
        setTeams([]);
      } finally {
        if (alive) setTeamsLoading(false);
      }
    }

    void loadTeams();

    return () => {
      alive = false;
    };
  }, [session, selectedTeamSlug]);

  function onSelectTeam(nextSlug: string) {
    setSelectedTeamSlug(nextSlug);
    if (nextSlug) {
      window.localStorage.setItem("sidebar-team-slug", nextSlug);
      router.push(`/teams/${nextSlug}`);
      return;
    }

    window.localStorage.removeItem("sidebar-team-slug");
    router.push("/teams");
  }

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
      {status !== "unauthenticated" || pathname !== "/" ? (
        <nav className="sidebar-mobile md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800/70 bg-zinc-950/95 backdrop-blur-sm">
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
      ) : null}

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
            <div className={collapsed ? "hidden" : "min-w-0"}>
              <div className="truncate text-sm font-semibold tracking-tight text-zinc-100">Deadlock Stats</div>
            </div>

            <div className="flex items-center gap-1.5">
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

          {!collapsed && session ? (
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] uppercase tracking-wide text-zinc-500">Team</label>
              <select
                value={selectedTeamSlug}
                onChange={(event) => onSelectTeam(event.target.value)}
                disabled={teamsLoading}
                className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-1.5 text-xs text-zinc-200"
              >
                <option value="">Individual</option>
                {teams.map((team) => (
                  <option key={`sidebar-team-${team.slug}`} value={team.slug}>
                    {team.name}
                  </option>
                ))}
              </select>
              <Link
                href="/teams"
                className="inline-flex w-full items-center justify-center rounded border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Create Team
              </Link>
            </div>
          ) : null}
        </div>

        {/* Navigation */}
        <nav className={collapsed ? "p-2 space-y-1.5" : "p-3 space-y-2"}>
          {NAV.filter((n) => (session ? true : n.href !== "/teams")).map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={collapsed ? n.label : undefined}
                className={[
                  "group flex items-center rounded-lg border text-sm transition-all duration-150 active:scale-[0.99]",
                  collapsed ? "justify-center" : "",
                  collapsed ? "h-11 px-2" : "h-11 px-3",
                  active ? "sidebar-link-active shadow-sm" : "sidebar-link-idle",
                ].join(" ")}
              >
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
            <div className="sidebar-muted mb-2 text-xs">
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
                <div className="sidebar-strong truncate text-xs">{session.user?.name ?? "Signed in"}</div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="sidebar-btn w-full rounded px-2.5 py-1.5 text-left text-xs"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="sidebar-btn block w-full rounded px-2.5 py-1.5 text-left text-xs"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
      </aside>
    </>
  );
}