"use client";

import { useMemo, useState } from "react";

type SnapshotPoint = {
  timeS: number;
  souls: number;
  damage: number;
  taken: number;
};

type BarStat = {
  label: string;
  value: number;
};

type PlayerGraphsProps = {
  snapshots: SnapshotPoint[];
  bars: BarStat[];
  compareSnapshots?: SnapshotPoint[];
  compareBars?: BarStat[];
  compareLabel?: string;
  xLabels?: string[];
};

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = 24;
const MATCH_TREND_WINDOW = 7;

function toPoints(values: number[], min: number, max: number) {
  if (!values.length) return "";

  const range = max - min || 1;
  const step = values.length > 1 ? (WIDTH - PADDING * 2) / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = PADDING + index * step;
      const y = HEIGHT - PADDING - ((value - min) / range) * (HEIGHT - PADDING * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function seriesRange(seriesList: number[][]) {
  const flattened = seriesList.flat().filter((value) => Number.isFinite(value));
  if (!flattened.length) {
    return { min: 0, max: 1 };
  }
  return {
    min: Math.min(...flattened),
    max: Math.max(...flattened),
  };
}

function exponentialSmooth(values: number[], alpha = 0.45) {
  if (!values.length) return values;

  const smoothed = [values[0]];
  for (let index = 1; index < values.length; index++) {
    smoothed[index] = alpha * values[index] + (1 - alpha) * smoothed[index - 1];
  }
  return smoothed;
}

function idxFromMouse(clientX: number, rectLeft: number, rectWidth: number, count: number) {
  if (count <= 1) return 0;
  const relative = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
  return Math.round(relative * (count - 1));
}

function fmt1(n: number) {
  return Number.isFinite(n) ? n.toFixed(1) : "-";
}

function rateSeries(series: SnapshotPoint[], key: "souls" | "damage" | "taken") {
  return series.map((point) => {
    const minutes = Math.max(1 / 60, point.timeS / 60);
    return point[key] / minutes;
  });
}

function valueSeries(series: SnapshotPoint[], key: "souls" | "damage" | "taken") {
  return series.map((point) => point[key]);
}

export default function PlayerGraphs({ snapshots, bars, compareSnapshots = [], compareBars = [], compareLabel = "Compare", xLabels }: PlayerGraphsProps) {
  const [showSouls, setShowSouls] = useState(true);
  const [showDamage, setShowDamage] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [soloSeries, setSoloSeries] = useState<"souls" | "damage" | "taken" | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const soulsSeries = useMemo(() => snapshots.map((s) => s.souls), [snapshots]);
  const damageSeries = useMemo(() => snapshots.map((s) => s.damage), [snapshots]);
  const takenSeries = useMemo(() => snapshots.map((s) => s.taken), [snapshots]);

  const compareSoulsSeries = useMemo(() => compareSnapshots.map((s) => s.souls), [compareSnapshots]);
  const compareDamageSeries = useMemo(() => compareSnapshots.map((s) => s.damage), [compareSnapshots]);
  const compareTakenSeries = useMemo(() => compareSnapshots.map((s) => s.taken), [compareSnapshots]);

  const mainRange = useMemo(
    () =>
      seriesRange([
        soulsSeries,
        damageSeries,
        takenSeries,
        compareSoulsSeries,
        compareDamageSeries,
        compareTakenSeries,
      ]),
    [soulsSeries, damageSeries, takenSeries, compareSoulsSeries, compareDamageSeries, compareTakenSeries],
  );

  const soulsLine = useMemo(() => toPoints(soulsSeries, mainRange.min, mainRange.max), [soulsSeries, mainRange]);
  const damageLine = useMemo(() => toPoints(damageSeries, mainRange.min, mainRange.max), [damageSeries, mainRange]);
  const takenLine = useMemo(() => toPoints(takenSeries, mainRange.min, mainRange.max), [takenSeries, mainRange]);

  const compareSoulsLine = useMemo(
    () => toPoints(compareSoulsSeries, mainRange.min, mainRange.max),
    [compareSoulsSeries, mainRange],
  );
  const compareDamageLine = useMemo(
    () => toPoints(compareDamageSeries, mainRange.min, mainRange.max),
    [compareDamageSeries, mainRange],
  );
  const compareTakenLine = useMemo(
    () => toPoints(compareTakenSeries, mainRange.min, mainRange.max),
    [compareTakenSeries, mainRange],
  );

  const useMatchScale = Boolean(xLabels?.length);
  const dpmSeries = useMemo(
    () => (useMatchScale ? valueSeries(snapshots, "damage") : rateSeries(snapshots, "damage")),
    [snapshots, useMatchScale],
  );
  const tpmSeries = useMemo(
    () => (useMatchScale ? valueSeries(snapshots, "taken") : rateSeries(snapshots, "taken")),
    [snapshots, useMatchScale],
  );
  const spmSeries = useMemo(
    () => (useMatchScale ? valueSeries(snapshots, "souls") : rateSeries(snapshots, "souls")),
    [snapshots, useMatchScale],
  );
  const compareDpmSeries = useMemo(
    () => (useMatchScale ? valueSeries(compareSnapshots, "damage") : rateSeries(compareSnapshots, "damage")),
    [compareSnapshots, useMatchScale],
  );
  const compareTpmSeries = useMemo(
    () => (useMatchScale ? valueSeries(compareSnapshots, "taken") : rateSeries(compareSnapshots, "taken")),
    [compareSnapshots, useMatchScale],
  );
  const compareSpmSeries = useMemo(
    () => (useMatchScale ? valueSeries(compareSnapshots, "souls") : rateSeries(compareSnapshots, "souls")),
    [compareSnapshots, useMatchScale],
  );

  const rateRange = useMemo(
    () => seriesRange([spmSeries, dpmSeries, tpmSeries, compareSpmSeries, compareDpmSeries, compareTpmSeries]),
    [spmSeries, dpmSeries, tpmSeries, compareSpmSeries, compareDpmSeries, compareTpmSeries],
  );

  const barMax = useMemo(() => Math.max(1, ...bars.map((x) => x.value)), [bars]);
  const compareBarMax = useMemo(() => Math.max(1, ...compareBars.map((x) => x.value)), [compareBars]);

  const active = activeIndex != null ? snapshots[activeIndex] : null;
  const activeLabel = activeIndex != null ? xLabels?.[activeIndex] : null;
  const xStep = snapshots.length > 1 ? (WIDTH - PADDING * 2) / (snapshots.length - 1) : 0;
  const activeX = activeIndex != null ? PADDING + activeIndex * xStep : null;

  const showSoulsLine = soloSeries ? soloSeries === "souls" : showSouls;
  const showDamageLine = soloSeries ? soloSeries === "damage" : showDamage;
  const showTakenLine = soloSeries ? soloSeries === "taken" : showTaken;
  const hasCompare = compareSnapshots.length > 1;
  const trendIndex = Math.max(0, Math.min(activeIndex ?? snapshots.length - 1, Math.max(0, snapshots.length - 1)));

  const trendWindow = useMemo(() => {
    if (!useMatchScale) {
      return { start: 0, end: Math.max(0, snapshots.length - 1) };
    }

    const halfWindow = Math.floor(MATCH_TREND_WINDOW / 2);
    let start = Math.max(0, trendIndex - halfWindow);
    let end = Math.min(Math.max(0, snapshots.length - 1), start + MATCH_TREND_WINDOW - 1);

    start = Math.max(0, end - MATCH_TREND_WINDOW + 1);
    return { start, end };
  }, [useMatchScale, trendIndex, snapshots.length]);

  function mapToCompareIndex(index: number) {
    if (compareSnapshots.length <= 1 || snapshots.length <= 1) {
      return Math.max(0, Math.min(compareSnapshots.length - 1, index));
    }

    return Math.round((index / (snapshots.length - 1)) * (compareSnapshots.length - 1));
  }

  const compareWindow = useMemo(() => {
    if (!useMatchScale) {
      return { start: 0, end: Math.max(0, compareSnapshots.length - 1) };
    }

    const start = Math.max(0, mapToCompareIndex(trendWindow.start));
    const end = Math.max(start, mapToCompareIndex(trendWindow.end));
    return { start, end };
  }, [useMatchScale, compareSnapshots.length, trendWindow]);

  const visibleSpmSeries = useMemo(
    () => (useMatchScale ? spmSeries.slice(trendWindow.start, trendWindow.end + 1) : spmSeries),
    [useMatchScale, spmSeries, trendWindow],
  );
  const visibleDpmSeries = useMemo(
    () => (useMatchScale ? dpmSeries.slice(trendWindow.start, trendWindow.end + 1) : dpmSeries),
    [useMatchScale, dpmSeries, trendWindow],
  );
  const visibleTpmSeries = useMemo(
    () => (useMatchScale ? tpmSeries.slice(trendWindow.start, trendWindow.end + 1) : tpmSeries),
    [useMatchScale, tpmSeries, trendWindow],
  );
  const visibleCompareSpmSeries = useMemo(
    () => (useMatchScale ? compareSpmSeries.slice(compareWindow.start, compareWindow.end + 1) : compareSpmSeries),
    [useMatchScale, compareSpmSeries, compareWindow],
  );
  const visibleCompareDpmSeries = useMemo(
    () => (useMatchScale ? compareDpmSeries.slice(compareWindow.start, compareWindow.end + 1) : compareDpmSeries),
    [useMatchScale, compareDpmSeries, compareWindow],
  );
  const visibleCompareTpmSeries = useMemo(
    () => (useMatchScale ? compareTpmSeries.slice(compareWindow.start, compareWindow.end + 1) : compareTpmSeries),
    [useMatchScale, compareTpmSeries, compareWindow],
  );

  const chartSpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleSpmSeries) : visibleSpmSeries),
    [useMatchScale, visibleSpmSeries],
  );
  const chartDpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleDpmSeries) : visibleDpmSeries),
    [useMatchScale, visibleDpmSeries],
  );
  const chartTpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleTpmSeries) : visibleTpmSeries),
    [useMatchScale, visibleTpmSeries],
  );
  const chartCompareSpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleCompareSpmSeries) : visibleCompareSpmSeries),
    [useMatchScale, visibleCompareSpmSeries],
  );
  const chartCompareDpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleCompareDpmSeries) : visibleCompareDpmSeries),
    [useMatchScale, visibleCompareDpmSeries],
  );
  const chartCompareTpmSeries = useMemo(
    () => (useMatchScale ? exponentialSmooth(visibleCompareTpmSeries) : visibleCompareTpmSeries),
    [useMatchScale, visibleCompareTpmSeries],
  );

  const visibleRateRange = useMemo(
    () =>
      useMatchScale
        ? seriesRange([
            chartSpmSeries,
            chartDpmSeries,
            chartTpmSeries,
            chartCompareSpmSeries,
            chartCompareDpmSeries,
            chartCompareTpmSeries,
          ])
        : rateRange,
    [
      useMatchScale,
      chartSpmSeries,
      chartDpmSeries,
      chartTpmSeries,
      chartCompareSpmSeries,
      chartCompareDpmSeries,
      chartCompareTpmSeries,
      rateRange,
    ],
  );

  const visibleSpmLine = useMemo(
    () => toPoints(chartSpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartSpmSeries, visibleRateRange],
  );
  const visibleDpmLine = useMemo(
    () => toPoints(chartDpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartDpmSeries, visibleRateRange],
  );
  const visibleTpmLine = useMemo(
    () => toPoints(chartTpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartTpmSeries, visibleRateRange],
  );
  const visibleCompareSpmLine = useMemo(
    () => toPoints(chartCompareSpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartCompareSpmSeries, visibleRateRange],
  );
  const visibleCompareDpmLine = useMemo(
    () => toPoints(chartCompareDpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartCompareDpmSeries, visibleRateRange],
  );
  const visibleCompareTpmLine = useMemo(
    () => toPoints(chartCompareTpmSeries, visibleRateRange.min, visibleRateRange.max),
    [chartCompareTpmSeries, visibleRateRange],
  );

  function toggleSeries(series: "souls" | "damage" | "taken") {
    if (soloSeries) {
      if (soloSeries === series) setSoloSeries(null);
      else setSoloSeries(series);
      return;
    }

    if (series === "souls") setShowSouls((v) => !v);
    if (series === "damage") setShowDamage((v) => !v);
    if (series === "taken") setShowTaken((v) => !v);
  }

  function enterSolo(series: "souls" | "damage" | "taken") {
    setSoloSeries(series);
  }

  function resetAllSeries() {
    setSoloSeries(null);
    setShowSouls(true);
    setShowDamage(true);
    setShowTaken(true);
  }

  const allActive = !soloSeries && showSouls && showDamage && showTaken;

  return (
    <section className="rounded-xl border border-zinc-800 p-4 md:p-5 space-y-4 bg-zinc-950/30">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-semibold">Graphs</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => toggleSeries("souls")}
            onDoubleClick={() => enterSolo("souls")}
            className={`px-2 py-1 rounded border ${showSoulsLine ? "border-emerald-500 text-emerald-300" : "border-zinc-700 opacity-70"} ${soloSeries === "souls" ? "ring-1 ring-emerald-400" : ""}`}
          >
            Souls
          </button>
          <button
            type="button"
            onClick={() => toggleSeries("damage")}
            onDoubleClick={() => enterSolo("damage")}
            className={`px-2 py-1 rounded border ${showDamageLine ? "border-blue-500 text-blue-300" : "border-zinc-700 opacity-70"} ${soloSeries === "damage" ? "ring-1 ring-blue-400" : ""}`}
          >
            Damage
          </button>
          <button
            type="button"
            onClick={() => toggleSeries("taken")}
            onDoubleClick={() => enterSolo("taken")}
            className={`px-2 py-1 rounded border ${showTakenLine ? "border-rose-500 text-rose-300" : "border-zinc-700 opacity-70"} ${soloSeries === "taken" ? "ring-1 ring-rose-400" : ""}`}
          >
            Taken
          </button>
          <button
            type="button"
            onClick={resetAllSeries}
            className={`px-2 py-1 rounded border ${allActive ? "border-zinc-400 text-zinc-100" : "border-zinc-700 hover:border-zinc-500"}`}
          >
            All
          </button>
        </div>
      </div>
      <p className="text-xs opacity-70">
        Click to toggle series. Double-click a chip to solo it. All restores every line.
        {hasCompare ? ` Dashed lines represent ${compareLabel}.` : ""}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded border border-zinc-800 p-3 lg:col-span-2">
          <p className="text-sm mb-2">Hover the chart to inspect a timestamp</p>
          {snapshots.length > 1 ? (
            <>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="w-full h-48"
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setActiveIndex(idxFromMouse(event.clientX, rect.left, rect.width, snapshots.length));
              }}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <line x1={PADDING} y1={HEIGHT - PADDING} x2={WIDTH - PADDING} y2={HEIGHT - PADDING} className="stroke-zinc-700" />

              {showSoulsLine ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400" points={soulsLine} />
              ) : null}
              {showSoulsLine && hasCompare ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-emerald-300/80" points={compareSoulsLine} />
              ) : null}
              {showDamageLine ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400" points={damageLine} />
              ) : null}
              {showDamageLine && hasCompare ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-blue-300/80" points={compareDamageLine} />
              ) : null}
              {showTakenLine ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" className="text-rose-400" points={takenLine} />
              ) : null}
              {showTakenLine && hasCompare ? (
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="8 5" className="text-rose-300/80" points={compareTakenLine} />
              ) : null}

              {activeX != null ? (
                <line
                  x1={activeX}
                  y1={PADDING}
                  x2={activeX}
                  y2={HEIGHT - PADDING}
                  stroke="currentColor"
                  className="text-zinc-500"
                  strokeDasharray="3 4"
                />
              ) : null}
            </svg>

            {active ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-4 text-xs">
                <p>{xLabels?.length ? "Match" : "Time"}: <span className="font-mono">{activeLabel ?? `${active.timeS}s`}</span></p>
                <p>Souls: <span className="font-mono">{active.souls}</span></p>
                <p>Damage: <span className="font-mono">{active.damage}</span></p>
                <p>Taken: <span className="font-mono">{active.taken}</span></p>
              </div>
            ) : null}
            </>
          ) : (
            <p className="text-sm opacity-70">Not enough points.</p>
          )}
        </div>

        <div className="rounded border border-zinc-800 p-3 space-y-2">
          <p className="text-sm">Damage profile</p>
          {bars.map((stat) => (
            <div key={stat.label} className="grid grid-cols-[90px_1fr_70px] items-center gap-2 text-xs">
              <span className="opacity-80">{stat.label}</span>
              <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                <div className="h-full bg-zinc-400" style={{ width: `${(stat.value / barMax) * 100}%` }} />
              </div>
              <span className="font-mono text-right">{stat.value}</span>
            </div>
          ))}

          {compareBars.length ? (
            <>
              <p className="text-sm pt-2 border-t border-zinc-800">{compareLabel} profile</p>
              {compareBars.map((stat) => (
                <div key={`compare-${stat.label}`} className="grid grid-cols-[90px_1fr_70px] items-center gap-2 text-xs">
                  <span className="opacity-80">{stat.label}</span>
                  <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-zinc-600" style={{ width: `${(stat.value / compareBarMax) * 100}%` }} />
                  </div>
                  <span className="font-mono text-right">{stat.value}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded border border-zinc-800 p-3">
        <p className="text-sm mb-2">{useMatchScale ? "Trend (per match)" : "Rate trend (per minute)"}</p>
        {snapshots.length > 1 ? (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-44">
            <line x1={PADDING} y1={HEIGHT - PADDING} x2={WIDTH - PADDING} y2={HEIGHT - PADDING} className="stroke-zinc-700" />

            <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-300" points={visibleSpmLine} />
            <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400" points={visibleDpmLine} />
            <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-400" points={visibleTpmLine} />

            {hasCompare ? (
              <>
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-amber-200/80" points={visibleCompareSpmLine} />
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-blue-300/80" points={visibleCompareDpmLine} />
                <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-rose-300/80" points={visibleCompareTpmLine} />
              </>
            ) : null}
          </svg>
        ) : (
          <p className="text-sm opacity-70">Not enough points.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded border border-amber-400/40 text-amber-300">{useMatchScale ? "Souls" : "S/min"}</span>
          <span className="px-2 py-1 rounded border border-blue-400/40 text-blue-300">{useMatchScale ? "Damage" : "Dmg/min"}</span>
          <span className="px-2 py-1 rounded border border-rose-400/40 text-rose-300">{useMatchScale ? "Taken" : "Taken/min"}</span>
          {hasCompare ? <span className="px-2 py-1 rounded border border-zinc-600 text-zinc-300">Dashed = {compareLabel}</span> : null}
        </div>
      </div>

      {snapshots.length > 1 ? (
        <div className="rounded border border-zinc-800 p-3">
          <label className="text-xs opacity-80" htmlFor="snapIndex">
            {xLabels?.length ? "Match scrubber" : "Snapshot scrubber"}
          </label>
          <input
            id="snapIndex"
            type="range"
            min={0}
            max={snapshots.length - 1}
            value={activeIndex ?? snapshots.length - 1}
            onChange={(event) => setActiveIndex(Number(event.target.value))}
            className="mt-2 w-full"
          />
          <p className="mt-1 text-xs opacity-70">
            {xLabels?.length
              ? `Selected match values — Souls: ${active ? active.souls : "-"}, Damage: ${active ? active.damage : "-"}, Taken: ${active ? active.taken : "-"}`
              : `Damage per min at selected point: ${active ? fmt1(active.damage / Math.max(1, active.timeS / 60)) : "-"}`}
          </p>
        </div>
      ) : null}
    </section>
  );
}
