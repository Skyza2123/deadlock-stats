import type { LanePlayerSnapshot, LaneSummary } from "../lib/matchLanesData";

function fmtTimeCompact(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function fmtNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function TeamLaneTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: LanePlayerSnapshot[];
  tone: "yellow" | "blue";
}) {
  const toneClass = tone === "yellow" ? "text-yellow-300" : "text-blue-300";

  return (
    <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
      <h3 className={`text-sm font-semibold ${toneClass}`}>{title}</h3>

      {rows.length ? (
        <div className="mt-3 overflow-x-auto rounded border border-zinc-800/80">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/70 text-zinc-400">
              <tr>
                <th className="px-2 py-1.5 text-left">Player</th>
                <th className="px-2 py-1.5 text-right">Lane</th>
                <th className="px-2 py-1.5 text-right">NW</th>
                <th className="px-2 py-1.5 text-right">K/D/A</th>
                <th className="px-2 py-1.5 text-right">LH/DN</th>
                <th className="px-2 py-1.5 text-right">SPM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.steamId}-${row.heroId ?? "unknown"}`} className="border-t border-zinc-800/80">
                  <td className="px-2 py-1.5">
                    <p className="font-medium text-zinc-200">{row.heroName}</p>
                    <p className="truncate text-zinc-500">{row.label}</p>
                  </td>
                  <td className="px-2 py-1.5 text-right text-zinc-300">{row.assignedLane ?? "-"}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-200">{fmtNumber(row.souls)}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-300">{row.kills}/{row.deaths}/{row.assists}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-300">{row.lastHits}/{row.denies}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-300">{fmtNumber(row.soulsPerMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">No lane snapshots available.</p>
      )}
    </article>
  );
}

export default function MatchLanesView({
  matchId,
  laneSummary,
}: {
  matchId: string;
  laneSummary: LaneSummary;
}) {
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4 md:p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lanes</h1>
          <p className="text-sm text-zinc-400">Match {matchId}</p>
        </div>
        <p className="text-xs text-zinc-400">Snapshot at {fmtTimeCompact(laneSummary.cutoffS)}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TeamLaneTable title="Hidden King" rows={laneSummary.team0} tone="yellow" />
        <TeamLaneTable title="Archmother" rows={laneSummary.team1} tone="blue" />
      </div>
    </section>
  );
}