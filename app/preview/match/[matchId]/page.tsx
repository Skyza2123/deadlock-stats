"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { getTempMatch } from "../../../../lib/tempMatchStore";
import { fmtTime, heroName } from "../../../../lib/deadlockData";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export default function PreviewMatchPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = String(params?.matchId ?? "");

  const payload = getTempMatch(matchId);

  const players = useMemo(() => {
    const list = payload?.rawJson?.match_info?.players;
    return Array.isArray(list) ? list : [];
  }, [payload]);

  if (!payload) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Preview expired</h1>
          <p className="mt-2 text-zinc-400">
            This temporary upload is not saved. Refreshing clears preview data when you are not signed in.
          </p>
          <Link href="/" className="mt-4 inline-block rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800">
            Back to home
          </Link>
        </section>
      </main>
    );
  }

  const raw = payload.rawJson;
  const winner = TEAM_NAMES[String(raw?.match_info?.winning_team ?? "")] ?? "Unknown";
  const duration = Number(raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? NaN);

  return (
    <main className="w-full p-6 md:p-8 space-y-5">
      <header className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
        <h1 className="text-2xl font-bold">Preview Match {matchId}</h1>
        <p className="mt-2 text-sm text-amber-300">
          You are not signed in. This match is temporary and will disappear on refresh.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Winner: {winner} • Duration: {Number.isFinite(duration) ? fmtTime(duration) : "-"}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
        <h2 className="text-lg font-semibold mb-3">Players</h2>
        {players.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/80">
                <tr>
                  <th className="p-3 text-left">Steam ID</th>
                  <th className="p-3 text-left">Hero</th>
                  <th className="p-3 text-left">K</th>
                  <th className="p-3 text-left">D</th>
                  <th className="p-3 text-left">A</th>
                  <th className="p-3 text-left">Souls</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p: any, idx: number) => (
                  <tr key={`${p?.account_id ?? "unknown"}-${idx}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                    <td className="p-3 font-mono">{String(p?.account_id ?? "-")}</td>
                    <td className="p-3">{heroName(p?.hero_id != null ? String(p.hero_id) : null)}</td>
                    <td className="p-3">{safeNum(p?.kills)}</td>
                    <td className="p-3">{safeNum(p?.deaths)}</td>
                    <td className="p-3">{safeNum(p?.assists)}</td>
                    <td className="p-3">{safeNum(p?.net_worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-zinc-400">No players found in this match payload.</p>
        )}
      </section>
    </main>
  );
}