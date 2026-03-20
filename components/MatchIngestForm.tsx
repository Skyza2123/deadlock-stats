"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { setTempMatch } from "../lib/tempMatchStore";

const INGEST_TEAM_STORAGE_KEY = "deadlock-ingest-team";

type TeamOption = {
  slug: string;
  name: string;
};

export default function MatchIngestForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const isSignedIn = Boolean(session);
  const [matchId, setMatchId] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [enemyTeamName, setEnemyTeamName] = useState("");
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

        const saved = window.localStorage.getItem(INGEST_TEAM_STORAGE_KEY) ?? "";
        const hasSaved = data.teams.some((team: TeamOption) => team.slug === saved);
        if (hasSaved) {
          setTeamSlug(saved);
        } else if (data.teams.length === 1) {
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const id = matchId.trim();
    const selectedTeam = teamSlug.trim();
    if (!id) return;
    if (isSignedIn && !selectedTeam) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append("matchId", id);
      if (isSignedIn) fd.append("teamSlug", selectedTeam);
      if (isSignedIn && enemyTeamName.trim()) fd.append("enemyTeamName", enemyTeamName.trim());

      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          data?.details
            ? `${data?.error ?? "Upload failed"}: ${data.details}`
            : (data?.error ?? `Upload failed (${res.status})`)
        );
        return;
      }

      if (data?.saved) {
        if (isSignedIn) window.localStorage.setItem(INGEST_TEAM_STORAGE_KEY, selectedTeam);

        setNotice(`Added ${data.matchId ?? id} to recent matches.`);
        setMatchId("");
        setEnemyTeamName("");
        router.refresh();
        return;
      }

      if (data?.fromDb && data?.matchId) {
        router.push(`/match/${data.matchId}`);
        return;
      }

      if (data?.matchJson) {
        setTempMatch(data.matchId ?? id, data.matchJson);
        router.push(`/preview/match/${data.matchId ?? id}`);
        return;
      }

      setNotice(data?.message ?? "Uploaded, but not saved because you are not signed in.");
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-2">
        {isSignedIn ? (
          <>
            <select
              value={teamSlug}
              onChange={(e) => {
                const next = e.target.value;
                setTeamSlug(next);
                if (next) window.localStorage.setItem(INGEST_TEAM_STORAGE_KEY, next);
              }}
              className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
              disabled={loading || teamsLoading || teams.length === 0}
            >
              <option value="">Select team for this upload</option>
              {teams.map((team) => (
                <option key={team.slug} value={team.slug}>
                  {team.name}
                </option>
              ))}
            </select>

            <input
              value={enemyTeamName}
              onChange={(e) => setEnemyTeamName(e.target.value)}
              placeholder="Enemy team name (optional)"
              className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
              disabled={loading}
            />
          </>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          placeholder="Match ID (e.g. 68623064)"
          className="flex-1 rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={
            loading ||
            !matchId.trim() ||
            (isSignedIn && (!teamSlug.trim() || teamsLoading || teams.length === 0))
          }
          className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading ? "Uploading..." : "Search"}
        </button>
        </div>
      </form>

      {error ? <p className="text-xs text-red-400 mt-2">{error}</p> : null}
      {notice ? <p className="text-xs text-amber-300 mt-2">{notice}</p> : null}
      {!error && !notice && teamsLoading ? (
        <p className="text-xs opacity-70 mt-2">Loading teams...</p>
      ) : null}
      {!error && !notice && isSignedIn && !teamsLoading && teams.length === 0 ? (
        <p className="text-xs text-amber-300 mt-2">
          Sign in and create at least one team before uploading matches.
        </p>
      ) : null}
      {!error && !notice ? (
        <p className="text-xs opacity-70 mt-2">
          Upload saves the match and adds it to recent matches.
        </p>
      ) : null}
    </>
  );
}