"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  type ScrimAssignment,
  type ScrimEntry,
  type ScrimMatch,
  createScrimInApi,
  deleteScrimInApi,
  fetchScrimsFromApi,
  formatScrimDate,
  normalizeScrimDate,
  readScrimsFromStorage,
  updateScrimInApi,
  writeScrimsToStorage,
} from "../lib/scrims";

type IconProps = {
  className?: string;
};

function PencilIcon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-4 1 1-4 11.5-13.5Z" />
    </svg>
  );
}

function TrashIcon({ className = "h-3.5 w-3.5" }: IconProps) {
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

function PlusIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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

type ModalMode = "create" | "edit";

function makeScrimId() {
  return `scrim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function todayIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ScrimDashboard() {
  const router = useRouter();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [scrims, setScrims] = useState<ScrimEntry[]>([]);
  const [scrimsLoading, setScrimsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingScrimId, setEditingScrimId] = useState<string | null>(null);

  const [scrimName, setScrimName] = useState("");
  const [assignment, setAssignment] = useState<ScrimAssignment>("team");
  const [teamSlug, setTeamSlug] = useState("");
  const [scrimDate, setScrimDate] = useState(todayIsoDate());
  const [firstMapCode, setFirstMapCode] = useState("");
  const [firstBansFile, setFirstBansFile] = useState<File | null>(null);
  const [isPublic, setIsPublic] = useState(true);

  const [filterMode, setFilterMode] = useState<"all" | ScrimAssignment>("all");
  const [searchText, setSearchText] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        if (data.teams.length === 1) {
          setTeamSlug(data.teams[0].slug);
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
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadScrims() {
      setScrimsLoading(true);
      try {
        const remote = await fetchScrimsFromApi();
        if (!alive) return;

        if (remote.length) {
          setScrims(remote);
          writeScrimsToStorage([]);
          return;
        }

        const local = readScrimsFromStorage();
        if (!local.length) {
          setScrims([]);
          return;
        }

        for (const scrim of local) {
          const migrated: ScrimEntry = {
            ...scrim,
            isPublic: typeof scrim.isPublic === "boolean" ? scrim.isPublic : true,
          };
          await createScrimInApi(migrated);
        }

        if (!alive) return;
        setScrims(await fetchScrimsFromApi());
        writeScrimsToStorage([]);
        setNotice("Migrated local scrims to your account.");
      } catch (err: any) {
        if (!alive) return;
        setError(String(err?.message ?? err));
      } finally {
        if (alive) setScrimsLoading(false);
      }
    }

    void loadScrims();
    return () => {
      alive = false;
    };
  }, []);

  const teamNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      map.set(team.slug, team.name);
    }
    return map;
  }, [teams]);

  const visibleScrims = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return scrims.filter((entry) => {
      if (!entry.isPublic) return false;
      if (filterMode !== "all" && entry.assignment !== filterMode) return false;
      if (!term) return true;

      return (
        entry.name.toLowerCase().includes(term) ||
        entry.teamName.toLowerCase().includes(term) ||
        entry.scrimDate.includes(term)
      );
    });
  }, [scrims, filterMode, searchText]);

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

  function resetForm() {
    setScrimName("");
    setAssignment("team");
    setScrimDate(normalizeScrimDate(todayIsoDate(), todayIsoDate()));
    setFirstMapCode("");
    setFirstBansFile(null);
    setIsPublic(true);
    setEditingScrimId(null);
  }

  function openCreateModal() {
    setModalMode("create");
    resetForm();
    setModalOpen(true);
  }

  function openEditModal(scrim: ScrimEntry) {
    setModalMode("edit");
    setEditingScrimId(scrim.id);
    setScrimName(scrim.name);
    setAssignment(scrim.assignment);
    setTeamSlug(scrim.teamSlug);
    setScrimDate(normalizeScrimDate(scrim.scrimDate, todayIsoDate()));
    setIsPublic(scrim.isPublic);
    setFirstMapCode("");
    setFirstBansFile(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setLoading(false);
    setFirstMapCode("");
    setFirstBansFile(null);
  }

  async function submitScrim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmedName = scrimName.trim();
    const trimmedFirstMapCode = firstMapCode.trim();
    const normalizedScrimDate = normalizeScrimDate(scrimDate, todayIsoDate());

    if (!trimmedName || !normalizedScrimDate) return;
    if (assignment === "team" && !teamSlug.trim()) return;
    if (modalMode === "create" && !trimmedFirstMapCode) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (modalMode === "edit" && editingScrimId) {
        const selectedTeamName =
          assignment === "team" ? (teamNameBySlug.get(teamSlug.trim()) ?? teamSlug.trim()) : "Individual";

        const updated = scrims.find((entry) => entry.id === editingScrimId);
        if (!updated) throw new Error("Scrim not found");

        const nextEntry: ScrimEntry = {
          ...updated,
          name: trimmedName,
          assignment,
          teamSlug: assignment === "team" ? teamSlug.trim() : "",
          teamName: selectedTeamName,
          scrimDate: normalizedScrimDate,
          isPublic,
        };

        await updateScrimInApi(nextEntry);
        setScrims(scrims.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)));
        setNotice(`Updated ${trimmedName}.`);
        closeModal();
        return;
      }

      const firstMatch = await ingestMatch({
        matchId: trimmedFirstMapCode,
        scrimName: trimmedName,
        assignment,
        teamSlug: teamSlug.trim(),
        scrimDate: normalizedScrimDate,
        bansFile: firstBansFile,
      });

      const selectedTeamName = assignment === "team" ? (teamNameBySlug.get(teamSlug.trim()) ?? teamSlug.trim()) : "";

      const nextEntry: ScrimEntry = {
        id: makeScrimId(),
        name: trimmedName,
        assignment,
        teamSlug: assignment === "team" ? teamSlug.trim() : "",
        teamName: assignment === "team" ? selectedTeamName : "Individual",
        scrimDate: normalizedScrimDate,
        isPublic,
        matches: [firstMatch],
        createdAt: new Date().toISOString(),
      };

      await createScrimInApi(nextEntry);
      setScrims([nextEntry, ...scrims]);
      setNotice(`Scrim \"${trimmedName}\" added.`);
      closeModal();
      resetForm();
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  async function removeScrim(scrimId: string) {
    await deleteScrimInApi(scrimId);
    setScrims(scrims.filter((entry) => entry.id !== scrimId));
  }

  return (
    <section className="panel-premium rounded-xl p-4 md:p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as "all" | ScrimAssignment)}
          className="w-full sm:w-40 rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        >
          <option value="all">Filter</option>
          <option value="team">Team scrims</option>
          <option value="individual">Individual scrims</option>
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search..."
          className="w-full sm:max-w-md rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        />
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}

      <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/35 p-3 min-h-70">
        {scrimsLoading ? <p className="px-1 pb-3 text-xs text-zinc-400">Loading scrims...</p> : null}
        {!scrimsLoading && !visibleScrims.length ? (
          <p className="px-1 pb-3 text-xs text-zinc-500">Only scrims marked Public appear here.</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleScrims.map((scrim) => (
            <article
              key={scrim.id}
              className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/45 p-4 transition-all hover:border-zinc-600/90 hover:bg-zinc-900/65"
            >
              <Link href={`/scrims/${scrim.id}`} className="absolute inset-0 z-0 rounded-xl" aria-label={`Open ${scrim.name}`} />

              <div className="relative z-10 space-y-3 pointer-events-none">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold leading-snug">{scrim.name}</h3>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditModal(scrim);
                    }}
                    className="pointer-events-auto rounded border border-zinc-700/80 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Edit scrim"
                    aria-label="Edit scrim"
                  >
                    <PencilIcon />
                  </button>
                </div>

                <div className="space-y-1 text-xs text-zinc-400">
                  <p>{formatScrimDate(scrim.scrimDate)}</p>
                  <p>{scrim.assignment === "team" ? scrim.teamName : "Individual"}</p>
                  <p>{scrim.matches.length} matches</p>
                  <p>{scrim.isPublic ? "Public" : "Private"}</p>
                </div>

                <div className={`h-2 w-2 rounded-full ${scrim.isPublic ? "bg-emerald-400/80" : "bg-zinc-500/80"}`} />
              </div>

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void removeScrim(scrim.id);
                }}
                className="absolute bottom-2 right-2 z-20 rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 opacity-0 transition-opacity hover:bg-rose-500/20 group-hover:opacity-100"
                title="Remove scrim"
                aria-label="Remove scrim"
              >
                <TrashIcon />
              </button>
            </article>
          ))}

          <article className="panel-premium-soft rounded-xl border border-dashed border-zinc-700/70 p-4 grid place-items-center min-h-37.5">
            <div className="text-center space-y-2">
              <p className="text-2xl leading-none text-zinc-400">+</p>
              <p className="text-lg font-semibold">Add a scrim...</p>
              <p className="text-xs text-zinc-500">Click the button to create a scrim.</p>
              <button
                type="button"
                onClick={openCreateModal}
                className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
              >
                <span className="inline-flex items-center gap-1.5">
                  <PlusIcon className="h-4 w-4" />
                  <span>Create Scrim</span>
                </span>
              </button>
            </div>
          </article>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 p-4 overflow-y-auto">
          <div className="panel-premium w-full max-w-xl rounded-t-xl sm:rounded-xl p-4 sm:p-6 my-auto relative max-h-[85vh] sm:max-h-none overflow-y-auto">
            <div className="mb-4 flex items-center justify-between sticky top-0 bg-inherit -m-4 sm:-m-6 p-4 sm:p-6 pb-4 sm:pb-4 border-b border-zinc-700/50">
              <h3 className="text-base sm:text-lg font-semibold">{modalMode === "create" ? "Create scrim" : "Edit scrim"}</h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded border border-zinc-700/80 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800 shrink-0"
                aria-label="Close modal"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <form className="space-y-3" onSubmit={submitScrim}>
              <input
                value={scrimName}
                onChange={(e) => setScrimName(e.target.value)}
                placeholder="Scrim name"
                className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                required
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={assignment}
                  onChange={(e) => setAssignment(e.target.value as ScrimAssignment)}
                  className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                >
                  <option value="team">Assign to team</option>
                  <option value="individual">Assign to individual</option>
                </select>

                <input
                  type="date"
                  value={scrimDate}
                  onChange={(e) => setScrimDate(e.target.value)}
                  className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  required
                />
              </div>

              {assignment === "team" ? (
                <select
                  value={teamSlug}
                  onChange={(e) => setTeamSlug(e.target.value)}
                  className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  disabled={teamsLoading || loading}
                  required
                >
                  <option value="">Select team</option>
                  {teams.map((team) => (
                    <option key={team.slug} value={team.slug}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <label className="flex items-center gap-2 rounded border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                <span>Public scrim (visible on dashboard)</span>
              </label>

              {modalMode === "create" ? (
                <>
                  <input
                    value={firstMapCode}
                    onChange={(e) => setFirstMapCode(e.target.value)}
                    placeholder="First map code / Match ID"
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                    required
                  />

                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Optional bans JSON</label>
                    <input
                      type="file"
                      accept="application/json"
                      onChange={(e) => setFirstBansFile(e.target.files?.[0] ?? null)}
                      className="w-full text-xs"
                    />
                  </div>
                </>
              ) : null}

              <button
                type="submit"
                disabled={
                  loading ||
                  !scrimName.trim() ||
                  !scrimDate ||
                  (modalMode === "create" && !firstMapCode.trim()) ||
                  (assignment === "team" && (!teamSlug.trim() || teamsLoading))
                }
                className="w-full rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5">
                  {loading ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : modalMode === "create" ? (
                    <PlusIcon className="h-4 w-4" />
                  ) : (
                    <SaveIcon className="h-4 w-4" />
                  )}
                  <span>{loading ? "Saving..." : modalMode === "create" ? "Create scrim" : "Save changes"}</span>
                </span>
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
