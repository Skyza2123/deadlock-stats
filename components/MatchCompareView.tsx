"use client";

import { useMemo, useState } from "react";

import type { ComparePlayer } from "../lib/matchCompareData";

function kda(k: number, d: number, a: number) {
  return (k + a) / Math.max(1, d);
}

type MatchCompareViewProps = {
  matchId: string;
  players: ComparePlayer[];
};

export default function MatchCompareView({ matchId, players }: MatchCompareViewProps) {
  const [leftPlayerId, setLeftPlayerId] = useState<string>(players[0]?.steamId ?? "");
  const [rightPlayerId, setRightPlayerId] = useState<string>(players[1]?.steamId ?? players[0]?.steamId ?? "");

  const leftPlayer = useMemo(
    () => players.find((player) => player.steamId === leftPlayerId) ?? null,
    [players, leftPlayerId]
  );
  const rightPlayer = useMemo(
    () => players.find((player) => player.steamId === rightPlayerId) ?? null,
    [players, rightPlayerId]
  );

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4 md:p-5 space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Player Comparison</h1>
        <p className="text-xs text-zinc-400">Match {matchId}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <select
          value={leftPlayerId}
          onChange={(event) => setLeftPlayerId(event.target.value)}
          className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        >
          {players.map((player) => (
            <option key={`left-${player.steamId}`} value={player.steamId}>
              {player.label}
            </option>
          ))}
        </select>
        <select
          value={rightPlayerId}
          onChange={(event) => setRightPlayerId(event.target.value)}
          className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        >
          {players.map((player) => (
            <option key={`right-${player.steamId}`} value={player.steamId}>
              {player.label}
            </option>
          ))}
        </select>
      </div>

      {leftPlayer && rightPlayer ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-900/25">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/70">
              <tr>
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">{leftPlayer.label}</th>
                <th className="px-3 py-2 text-right">{rightPlayer.label}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Hero", leftPlayer.heroName, rightPlayer.heroName],
                ["Kills", leftPlayer.kills, rightPlayer.kills],
                ["Deaths", leftPlayer.deaths, rightPlayer.deaths],
                ["Assists", leftPlayer.assists, rightPlayer.assists],
                ["KDA", kda(leftPlayer.kills, leftPlayer.deaths, leftPlayer.assists).toFixed(2), kda(rightPlayer.kills, rightPlayer.deaths, rightPlayer.assists).toFixed(2)],
                ["Souls", leftPlayer.netWorth, rightPlayer.netWorth],
                ["S/min", leftPlayer.soulsPerMin.toFixed(2), rightPlayer.soulsPerMin.toFixed(2)],
                ["Last Hits", leftPlayer.lastHits, rightPlayer.lastHits],
                ["Denies", leftPlayer.denies, rightPlayer.denies],
                ["Level", leftPlayer.level, rightPlayer.level],
              ].map(([metric, left, right]) => (
                <tr key={String(metric)} className="border-t border-zinc-800/80">
                  <td className="px-3 py-2 text-zinc-400">{metric}</td>
                  <td className="px-3 py-2 text-right">{String(left)}</td>
                  <td className="px-3 py-2 text-right">{String(right)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">No player data found for this match.</p>
      )}
    </section>
  );
}