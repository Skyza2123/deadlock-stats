"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type MatchCodeRow = {
  matchId: string;
  ingestedAtText: string;
};

type Props = {
  teamRows: MatchCodeRow[];
  tournamentRows: MatchCodeRow[];
  defaultTab?: "team" | "tournament";
};

export default function MatchesTabs({
  teamRows,
  tournamentRows,
  defaultTab = "team",
}: Props) {
  const [tab, setTab] = useState<"team" | "tournament">(defaultTab);

  const visibleRows = useMemo(
    () => (tab === "team" ? teamRows : tournamentRows),
    [tab, teamRows, tournamentRows]
  );

  return (
    <section className="panel-premium rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-luxe text-2xl font-bold tracking-tight">Tournaments</h1>
        <div className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-900/70 p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab("team")}
            className={`rounded px-2 py-1 ${tab === "team" ? "bg-zinc-700/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Team codes ({teamRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("tournament")}
            className={`rounded px-2 py-1 ${tab === "tournament" ? "bg-zinc-700/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Tournament uploaded codes ({tournamentRows.length})
          </button>
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80">
              <tr>
                <th className="p-3 text-left">Match code</th>
                <th className="p-3 text-left">Uploaded</th>
                <th className="p-3 text-left">Open</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.matchId} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                  <td className="p-3 font-mono">{row.matchId}</td>
                  <td className="p-3">{row.ingestedAtText}</td>
                  <td className="p-3">
                    <Link className="text-emerald-300 hover:text-emerald-200 hover:underline" href={`/match/${row.matchId}`}>
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          {tab === "team"
            ? "No team match codes yet."
            : "No tournament uploaded codes yet."}
        </p>
      )}
    </section>
  );
}
