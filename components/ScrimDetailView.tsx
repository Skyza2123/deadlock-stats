"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  type ScrimAssignment,
  type ScrimEntry,
  type ScrimMatch,
  formatScrimDate,
  normalizeScrimDate,
  readScrimsFromStorage,
  writeScrimsToStorage,
} from "../lib/scrims";

type IconProps = {
  className?: string;
};

function SettingsIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M10.325 4.317a1.724 1.724 0 0 1 3.35 0 1.724 1.724 0 0 0 2.573 1.066 1.724 1.724 0 0 1 2.9 1.676 1.724 1.724 0 0 0 .75 2.376 1.724 1.724 0 0 1 0 3.132 1.724 1.724 0 0 0-.75 2.376 1.724 1.724 0 0 1-2.9 1.676 1.724 1.724 0 0 0-2.573 1.066 1.724 1.724 0 0 1-3.35 0 1.724 1.724 0 0 0-2.573-1.066 1.724 1.724 0 0 1-2.9-1.676 1.724 1.724 0 0 0-.75-2.376 1.724 1.724 0 0 1 0-3.132 1.724 1.724 0 0 0 .75-2.376 1.724 1.724 0 0 1 2.9-1.676 1.724 1.724 0 0 0 2.573-1.066Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SaveIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

function TrashIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 .9H7a1 1 0 0 1-1-.9L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function TagIcon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m20.59 13.41-7.18 7.18a2 2 0 0 1-2.82 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function PlusIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function XIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m18 6-12 12" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SpinnerIcon({ className = "h-4 w-4 animate-spin" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}

type TeamOption = {
  slug: string;
  name: string;
};

function todayIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ScrimDetailView({ scrimId }: { scrimId: string }) {
  const router = useRouter();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [scrims, setScrims] = useState<ScrimEntry[]>([]);

  const [scrimName, setScrimName] = useState("");
  const [assignment, setAssignment] = useState<ScrimAssignment>("team");
  const [teamSlug, setTeamSlug] = useState("");
  const [scrimDate, setScrimDate] = useState("");

  const [matchCode, setMatchCode] = useState("");
  const [bansFile, setBansFile] = useState<File | null>(null);
  const [addingMatch, setAddingMatch] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingBansForMatchId, setUploadingBansForMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [showAddMapForm, setShowAddMapForm] = useState(false);

  useEffect(() => {
    setScrims(readScrimsFromStorage());
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadTeams() {
      try {
        const res = await fetch("/api/teams", { cache: "no-store" });
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (!res.ok || !data?.ok || !Array.isArray(data?.teams)) {
          setTeams([]);
          return;
        }

        setTeams(data.teams);
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
  }, []);

  const scrim = useMemo(() => scrims.find((entry) => entry.id === scrimId) ?? null, [scrims, scrimId]);

  useEffect(() => {
    if (!scrim) return;

    setScrimName(scrim.name);
    setAssignment(scrim.assignment);
    setTeamSlug(scrim.teamSlug);
    setScrimDate(normalizeScrimDate(scrim.scrimDate, todayIsoDate()));
  }, [scrim]);

  const teamNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      map.set(team.slug, team.name);
    }
    return map;
  }, [teams]);

  function persist(next: ScrimEntry[]) {
    setScrims(next);
    writeScrimsToStorage(next);
  }

  async function ingestMatch(args: {
    matchId: string;
    scrimName: string;
    assignment: ScrimAssignment;
    teamSlug: string;
    scrimDate: string;
    bansFile: File | null;
  }) {
    const fd = new FormData();
    fd.append("matchId", args.matchId);
    fd.append("scrimName", args.scrimName);
    fd.append("assignmentType", args.assignment);
    fd.append("scrimDate", args.scrimDate);
    if (args.assignment === "team") {
      fd.append("teamSlug", args.teamSlug);
    }

    const ingestRes = await fetch("/api/ingest", { method: "POST", body: fd });
    const ingestData = await ingestRes.json().catch(() => null);

    if (!ingestRes.ok || !ingestData?.ok) {
      const detail = String(ingestData?.details ?? ingestData?.error ?? `Upload failed (${ingestRes.status})`);
      throw new Error(detail);
    }

    let bansUploaded = false;

    if (args.bansFile) {
      const bansForm = new FormData();
      bansForm.append("matchId", args.matchId);
      bansForm.append("bansFile", args.bansFile);

      const bansRes = await fetch("/api/ingest-bans", { method: "POST", body: bansForm });
      const bansData = await bansRes.json().catch(() => null);

      if (!bansRes.ok || !bansData?.ok) {
        const detail = String(bansData?.details ?? bansData?.error ?? `Bans upload failed (${bansRes.status})`);
        throw new Error(detail);
      }

      bansUploaded = true;
    }

    return {
      matchId: args.matchId,
      bansUploaded,
      uploadedAt: new Date().toISOString(),
    } satisfies ScrimMatch;
  }

  async function onSaveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!scrim) return;

    const name = scrimName.trim();
    const normalizedDate = normalizeScrimDate(scrimDate, todayIsoDate());

    if (!name || !normalizedDate) return;
    if (assignment === "team" && !teamSlug.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const resolvedTeamSlug = assignment === "team" ? teamSlug.trim() : "";

      for (const match of scrim.matches) {
        await ingestMatch({
          matchId: match.matchId,
          scrimName: name,
          assignment,
          teamSlug: resolvedTeamSlug,
          scrimDate: normalizedDate,
          bansFile: null,
        });
      }

      const selectedTeamName =
        assignment === "team"
          ? (teamNameBySlug.get(teamSlug.trim()) ?? teamSlug.trim())
          : "Individual";

      const next = scrims.map((entry) =>
        entry.id === scrim.id
          ? {
              ...entry,
              name,
              assignment,
              teamSlug: assignment === "team" ? teamSlug.trim() : "",
              teamName: selectedTeamName,
              scrimDate: normalizedDate,
            }
          : entry
      );

      persist(next);
      setNotice("Scrim details updated and all map dates synced.");
      setIsEditOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  async function onAddMatch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!scrim) return;

    const trimmed = matchCode.trim();
    if (!trimmed) return;

    setAddingMatch(true);
    setError(null);
    setNotice(null);

    try {
      const match = await ingestMatch({
        matchId: trimmed,
        scrimName: scrim.name,
        assignment: scrim.assignment,
        teamSlug: scrim.teamSlug,
        scrimDate: scrim.scrimDate,
        bansFile,
      });

      const next = scrims.map((entry) =>
        entry.id === scrim.id
          ? {
              ...entry,
              matches: [match, ...entry.matches],
            }
          : entry
      );

      persist(next);
      setMatchCode("");
      setBansFile(null);
      setNotice(`Added match ${trimmed}.`);
      setShowAddMapForm(false);
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setAddingMatch(false);
    }
  }

  async function onUploadMapBans(matchId: string, file: File) {
    if (!scrim) return;

    setUploadingBansForMatchId(matchId);
    setError(null);
    setNotice(null);

    try {
      const bansForm = new FormData();
      bansForm.append("matchId", matchId);
      bansForm.append("bansFile", file);

      const bansRes = await fetch("/api/ingest-bans", { method: "POST", body: bansForm });
      const bansData = await bansRes.json().catch(() => null);

      if (!bansRes.ok || !bansData?.ok) {
        const detail = String(bansData?.details ?? bansData?.error ?? `Bans upload failed (${bansRes.status})`);
        throw new Error(detail);
      }

      const next = scrims.map((entry) =>
        entry.id === scrim.id
          ? {
              ...entry,
              matches: entry.matches.map((match) =>
                match.matchId === matchId ? { ...match, bansUploaded: true } : match
              ),
            }
          : entry
      );

      persist(next);

      const banCount = Number(bansData?.banCount ?? 0);
      setNotice(
        `Bans uploaded for ${matchId}${Number.isFinite(banCount) && banCount > 0 ? ` (${banCount})` : ""}.`
      );
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setUploadingBansForMatchId(null);
    }
  }

  function onDeleteScrim() {
    if (!scrim) return;

    const confirmed = window.confirm(`Delete scrim \"${scrim.name}\"? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);

    const next = scrims.filter((entry) => entry.id !== scrim.id);
    persist(next);
    router.push("/");
    router.refresh();
  }

  if (!scrim) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4">
        <Link href="/" className="text-sm text-zinc-300 hover:underline">← Back to dashboard</Link>
        <section className="panel-premium rounded-xl p-5">
          <h1 className="text-2xl font-semibold">Scrim not found</h1>
          <p className="mt-2 text-sm text-zinc-400">This scrim no longer exists in your dashboard storage.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href="/" className="hover:underline">← Back to dashboard</Link>
        {scrim.assignment === "team" && scrim.teamSlug ? (
          <>
            <span className="text-zinc-500">|</span>
            <Link href={`/teams/${scrim.teamSlug}`} className="hover:underline">View team stats →</Link>
          </>
        ) : null}
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}

      <section className="space-y-5">
        <header className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="heading-luxe text-3xl sm:text-4xl font-bold tracking-tight">{scrim.name}</h1>
            <button
              type="button"
              onClick={() => setIsEditOpen((value) => !value)}
              className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              title="Open scrim settings"
              aria-label="Open scrim settings"
            >
              <SettingsIcon />
            </button>
          </div>
          <p className="text-2xl font-semibold text-zinc-100">{formatScrimDate(scrim.scrimDate)}</p>
        </header>

        {isEditOpen ? (
          <section className="panel-premium rounded-xl p-4 md:p-5 max-w-3xl space-y-4">
            <h2 className="text-lg font-semibold">Scrim settings</h2>
            <form className="space-y-4" onSubmit={onSaveDetails}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Display Name</label>
                <input
                  value={scrimName}
                  onChange={(e) => setScrimName(e.target.value)}
                  className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assignment</label>
                  <select
                    value={assignment}
                    onChange={(e) => setAssignment(e.target.value as ScrimAssignment)}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  >
                    <option value="team">Team</option>
                    <option value="individual">Individual</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Scrim Date</label>
                  <input
                    type="date"
                    value={scrimDate}
                    onChange={(e) => setScrimDate(e.target.value)}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>

              {assignment === "team" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Team</label>
                  <select
                    value={teamSlug}
                    onChange={(e) => setTeamSlug(e.target.value)}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                    disabled={teamsLoading}
                    required
                  >
                    <option value="">Select team</option>
                    {teams.map((team) => (
                      <option key={team.slug} value={team.slug}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !scrimName.trim() || !scrimDate || (assignment === "team" && (!teamSlug.trim() || teamsLoading))}
                  className="rounded border border-indigo-500/40 bg-indigo-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {saving ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                    <span>{saving ? "Updating..." : "Save edits"}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="rounded border border-zinc-700/80 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <XIcon className="h-4 w-4" />
                    <span>Cancel</span>
                  </span>
                </button>
              </div>
            </form>

            <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-rose-300">Danger Zone</p>
              <h3 className="mt-2 text-lg font-semibold">Delete Scrim</h3>
              <p className="mt-1 text-xs text-zinc-400">Once deleted, this scrim cannot be recovered.</p>
              <button
                type="button"
                onClick={onDeleteScrim}
                disabled={deleting}
                className="mt-3 rounded border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/20 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5">
                  {deleting ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <TrashIcon className="h-4 w-4" />}
                  <span>{deleting ? "Deleting..." : "Delete Scrim"}</span>
                </span>
              </button>
            </section>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-4xl font-semibold tracking-tight">Matches</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
            {scrim.matches.map((match, index) => (
              <div key={`${scrim.id}-${match.matchId}`} className="relative h-40 sm:h-44">
                <Link
                  href={`/match/${match.matchId}`}
                  className="group relative block h-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900"
                >
                  <Image
                    src="/assets/backgrounds/Background_Menu.png"
                    alt={`Match ${index + 1}`}
                    fill
                    className="object-cover opacity-75 transition duration-200 group-hover:scale-[1.02] group-hover:opacity-90"
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-zinc-950/80 via-zinc-900/20 to-transparent" />
                  <div className="absolute inset-0 p-4 flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-2 pr-24">
                      <p className="text-3xl font-bold text-white drop-shadow"> Match {index + 1}</p>
                      {match.bansUploaded ? (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-400/40">
                          Bans added
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs font-mono text-zinc-200/95">{match.matchId}</p>
                  </div>
                </Link>

                <label
                  className="absolute right-3 top-3 z-20 cursor-pointer rounded-md border border-amber-400/40 bg-zinc-950/85 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-zinc-900"
                  title={match.bansUploaded ? "Replace bans" : "Add bans"}
                  aria-label={match.bansUploaded ? "Replace bans" : "Add bans"}
                >
                  <span className="inline-flex items-center justify-center">
                    {uploadingBansForMatchId === match.matchId ? (
                      <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <TagIcon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={uploadingBansForMatchId === match.matchId}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      if (!file) return;
                      void onUploadMapBans(match.matchId, file);
                    }}
                  />
                </label>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setShowAddMapForm((value) => !value)}
              className="h-40 sm:h-44 rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-900/20 text-zinc-300 hover:bg-zinc-900/40"
            >
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <span className="text-zinc-300"><PlusIcon className="h-5 w-5" /></span>
                <span className="text-sm font-semibold">Add a map...</span>
                <span className="text-xs text-zinc-500">click to browse</span>
              </div>
            </button>
          </div>

          {showAddMapForm ? (
            <form onSubmit={onAddMatch} className="rounded-xl border border-zinc-700/80 bg-zinc-900/30 p-3 sm:p-4 space-y-2 max-w-xl">
              <p className="text-sm font-medium text-zinc-200">Add map</p>
              <input
                value={matchCode}
                onChange={(e) => setMatchCode(e.target.value)}
                placeholder="Match code / Match ID"
                className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                required
              />
              <input
                type="file"
                accept="application/json"
                onChange={(e) => setBansFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={addingMatch || !matchCode.trim()}
                  className="rounded border border-emerald-500/40 bg-emerald-700/90 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {addingMatch ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                    <span>{addingMatch ? "Adding..." : "Add map"}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddMapForm(false)}
                  className="rounded border border-zinc-700/80 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <XIcon className="h-4 w-4" />
                    <span>Cancel</span>
                  </span>
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}
