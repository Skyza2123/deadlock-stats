import BackButton from "../../../../components/BackButton";
import MatchTabsNav from "../../../../components/MatchTabsNav";
import { loadMatchChartsData } from "../../../../lib/matchChartsData";

function fmtNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function buildPolyline(series: Array<{ team0: number; team1: number }>, key: "team0" | "team1") {
  const maxValue = Math.max(1, ...series.map((point) => Math.max(point.team0, point.team1)));
  return series
    .map((point, index) => {
      const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 100;
      const y = 100 - (point[key] / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

export default async function MatchChartsPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const data = await loadMatchChartsData(matchId);

  const netWorthPolyline0 = buildPolyline(data.netWorthSeries, "team0");
  const netWorthPolyline1 = buildPolyline(data.netWorthSeries, "team1");

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
      <BackButton />
      <MatchTabsNav matchId={matchId} active="charts" />

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Charts</h1>
            <p className="text-sm text-zinc-400">Match {data.matchId}</p>
          </div>
          <div className="text-right text-xs text-zinc-400">
            <p>Winner: {data.winnerLabel}</p>
            <p>
              Final score: {data.score.team0} - {data.score.team1}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Team Totals</p>
            <div className="mt-3 space-y-2 text-sm">
              {["kills", "souls", "damage", "healing"].map((metric) => {
                const left = Number((data.teamMetrics[0] as any)?.[metric] ?? 0);
                const right = Number((data.teamMetrics[1] as any)?.[metric] ?? 0);
                const max = Math.max(1, left, right);

                return (
                  <div key={metric} className="space-y-1">
                    <p className="text-xs text-zinc-400 capitalize">{metric}</p>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="h-2 overflow-hidden rounded bg-cyan-500/25">
                        <div className="h-full bg-cyan-400" style={{ width: `${(left / max) * 100}%` }} />
                      </div>
                      <span className="font-mono text-xs text-zinc-500">
                        {fmtNumber(left)} / {fmtNumber(right)}
                      </span>
                      <div className="h-2 overflow-hidden rounded bg-rose-500/25">
                        <div className="ml-auto h-full bg-rose-400" style={{ width: `${(right / max) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Net Worth Over Time</p>
            <div className="mt-3 rounded border border-zinc-800/80 bg-zinc-950/35 p-2">
              <svg viewBox="0 0 100 100" className="h-44 w-full">
                <polyline points={netWorthPolyline0} fill="none" stroke="rgb(34 211 238)" strokeWidth="1.6" />
                <polyline points={netWorthPolyline1} fill="none" stroke="rgb(244 63 94)" strokeWidth="1.6" />
              </svg>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                {data.teamMetrics[0]?.label ?? "Team 0"}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                {data.teamMetrics[1]?.label ?? "Team 1"}
              </span>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
