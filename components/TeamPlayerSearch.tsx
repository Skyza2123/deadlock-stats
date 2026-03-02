"use client";

import { useMemo, useState } from "react";

type TeamOption = {
  slug: string;
  name: string;
};

type PlayerOption = {
  steamId: string;
  displayName: string | null;
};

type Props = {
  teams: TeamOption[];
  players: PlayerOption[];
  defaultTeamSlug: string;
  addPlayerAction: (formData: FormData) => void | Promise<void>;
};

export default function TeamPlayerSearch({
  teams,
  players,
  defaultTeamSlug,
  addPlayerAction,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState(defaultTeamSlug);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [] as PlayerOption[];

    return players
      .filter((player) => {
        const name = (player.displayName ?? "").toLowerCase();
        const steam = player.steamId.toLowerCase();
        return name.includes(term) || steam.includes(term);
      })
      .slice(0, 30);
  }, [players, query]);

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="mb-1 block text-sm text-zinc-300">Team</label>
        <select
          value={selectedTeam}
          onChange={(event) => setSelectedTeam(event.target.value)}
          className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        >
          {teams.map((team) => (
            <option key={`search-${team.slug}`} value={team.slug}>
              {team.name} ({team.slug})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-300">Search DB by name or Steam ID</label>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. abbey or 7656119..."
          className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        />
      </div>

      {query.trim() ? (
        results.length ? (
          <div className="rounded border border-zinc-800/80 bg-zinc-950/35 p-2">
            <p className="mb-2 text-xs text-zinc-400">Results: {results.length} (max 30)</p>
            <div className="space-y-2">
              {results.map((player) => (
                <div
                  key={`search-result-${player.steamId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{player.displayName ?? "(unknown)"}</p>
                    <p className="font-mono text-xs text-zinc-500">{player.steamId}</p>
                  </div>
                  <form action={addPlayerAction}>
                    <input type="hidden" name="teamSlug" value={selectedTeam} />
                    <input type="hidden" name="playerSteamId" value={player.steamId} />
                    <button
                      type="submit"
                      className="rounded border border-emerald-500/40 bg-emerald-700/90 px-2.5 py-1.5 text-xs font-medium hover:bg-emerald-600"
                    >
                      Add to team
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No matching players found in database.</p>
        )
      ) : (
        <p className="text-xs text-zinc-500">Type a name or Steam ID to search teammates.</p>
      )}
    </div>
  );
}
