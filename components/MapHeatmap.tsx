"use client";

import HeroIcon from "./HeroIcon";
import { useState } from "react";
import { heroName } from "../lib/deadlockData";
import { heroSmallIconPath } from "../lib/heroIcons.client";
import type { HeatmapSeries } from "../lib/mapHeatmap";

type MapHeatmapProps = {
  title: string;
  description: string;
  kills: HeatmapSeries;
  deaths: HeatmapSeries;
};

function intensity(value: number, maxValue: number): number {
  if (maxValue <= 0) return 0;
  return Math.max(0.06, Math.min(1, Math.sqrt(value / maxValue)));
}

function formatTimeLabel(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Unknown time";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function displayHeroLabel(heroId: string | null | undefined, fallback: string): string {
  if (heroId) return heroName(heroId);
  return fallback || "Unknown";
}

function formatEventHeadline(event: HeatmapSeries["cells"][number]["events"][number]): string {
  const actor = displayHeroLabel(event.actorHeroId, event.actor);
  const target = displayHeroLabel(event.targetHeroId, event.target);
  if (event.type === "kill") return `${actor} killed ${target}`;
  if (event.type === "death") return `${target} died to ${actor}`;
  return `${actor} position event`;
}

function HeatmapCard({
  title,
  subtitle,
  series,
  tone,
  zoom,
}: {
  title: string;
  subtitle: string;
  series: HeatmapSeries;
  tone: "emerald" | "rose";
  zoom: number;
}) {
  const dotClass =
    tone === "emerald"
      ? "bg-emerald-400"
      : "bg-rose-400";
  const mapMaxWidthPx = Math.round(560 * zoom);
  const dotScale = Math.max(0.9, zoom);

  return (
    <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[11px] text-zinc-400">{subtitle}</span>
      </div>
      <div className="mx-auto w-full max-w-140" style={{ maxWidth: `${mapMaxWidthPx}px` }}>
        <div className="relative overflow-visible rounded border border-zinc-800/80 bg-zinc-950/40 aspect-square max-h-[68vh]">
          <img
            src="/assets/map/minimap_mid.webp"
            alt="Deadlock minimap"
            className="absolute inset-0 h-full w-full object-cover opacity-90"
          />
          <div className="absolute inset-0">
              {series.cells.map((cell, index) => {
                const alpha = intensity(cell.value, series.maxValue);
                const sizeBase = 8;
                const sizeRange = 16;
            const size = (sizeBase + alpha * sizeRange) * dotScale;
            const primaryEvent = cell.events[0] ?? null;
            const popupMatchLabel = primaryEvent?.matchId ? `Match ${primaryEvent.matchId}` : "Match unknown";
            const actorLabel = primaryEvent ? displayHeroLabel(primaryEvent.actorHeroId, primaryEvent.actor) : "Unknown";
            const targetLabel = primaryEvent ? displayHeroLabel(primaryEvent.targetHeroId, primaryEvent.target) : "Unknown";
            const actorHeroSrc = primaryEvent?.actorHeroId ? heroSmallIconPath(primaryEvent.actorHeroId) : null;
            const targetHeroSrc = primaryEvent?.targetHeroId ? heroSmallIconPath(primaryEvent.targetHeroId) : null;
            const summaryLeftLabel = primaryEvent?.type === "death" ? targetLabel : actorLabel;
            const summaryLeftIcon = primaryEvent?.type === "death" ? targetHeroSrc : actorHeroSrc;
            const summaryRightLabel = primaryEvent?.type === "death" ? actorLabel : targetLabel;
            const summaryRightIcon = primaryEvent?.type === "death" ? actorHeroSrc : targetHeroSrc;
            const popupHorizontalClass =
              cell.x > 0.82 ? "right-0 translate-x-0" : cell.x < 0.18 ? "left-0 -translate-x-0" : "left-1/2 -translate-x-1/2";
            const popupVerticalClass = cell.y < 0.2 ? "top-full mt-2 translate-y-0" : "top-0 -translate-y-[112%]";

                return (
                  <details
                    key={`${title}-cell-${index}`}
                    className="group absolute"
                    name={`${title.replace(/\s+/g, "-").toLowerCase()}-events`}
                    style={{
                      left: `${cell.x * 100}%`,
                      top: `${cell.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <summary
                      className={`list-none cursor-pointer rounded-full ${dotClass} outline-none ring-offset-0 transition-[box-shadow,transform] group-open:scale-110 group-open:ring-2 group-open:ring-yellow-300 group-open:ring-offset-1 group-open:ring-offset-zinc-950 [&::-webkit-details-marker]:hidden`}
                      style={{
                        width: `${size}px`,
                        height: `${size}px`,
                        opacity: alpha,
                      }}
                      aria-label={`${title} event bubble`}
                    />

                    {primaryEvent ? (
                      <div className={`absolute z-20 hidden min-w-72 rounded border border-zinc-600 bg-zinc-950 p-2.5 text-[12px] leading-tight text-zinc-100 shadow-2xl group-open:block ${popupHorizontalClass} ${popupVerticalClass}`}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                          <span>{popupMatchLabel}</span>
                          <span>{cell.value.toFixed(0)} events</span>
                        </div>

                        <div className="mb-1.5 rounded border border-zinc-800 bg-zinc-900/70 p-1.5">
                          <div className="flex items-center justify-center gap-1.5 font-semibold">
                            <span className="inline-flex items-center gap-1">
                              <HeroIcon src={summaryLeftIcon} alt={summaryLeftLabel} width={14} height={14} className="h-3.5 w-3.5 rounded" />
                              <span className="max-w-24 truncate">{summaryLeftLabel}</span>
                            </span>
                            <span aria-hidden>⚔</span>
                            <span className="inline-flex items-center gap-1">
                              <HeroIcon src={summaryRightIcon} alt={summaryRightLabel} width={14} height={14} className="h-3.5 w-3.5 rounded" />
                              <span className="max-w-24 truncate">{summaryRightLabel}</span>
                            </span>
                          </div>
                        </div>

                        <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                          {cell.events.slice(0, 12).map((event, eventIndex) => {
                            const rowActorLabel = displayHeroLabel(event.actorHeroId, event.actor);
                            const rowTargetLabel = displayHeroLabel(event.targetHeroId, event.target);
                            const rowActorHeroSrc = event.actorHeroId ? heroSmallIconPath(event.actorHeroId) : null;
                            const rowTargetHeroSrc = event.targetHeroId ? heroSmallIconPath(event.targetHeroId) : null;
                            const rowLeftLabel = event.type === "death" ? rowTargetLabel : rowActorLabel;
                            const rowLeftIcon = event.type === "death" ? rowTargetHeroSrc : rowActorHeroSrc;
                            const rowRightLabel = event.type === "death" ? rowActorLabel : rowTargetLabel;
                            const rowRightIcon = event.type === "death" ? rowActorHeroSrc : rowTargetHeroSrc;
                            const matchLabel = event.matchId ? `Match ${event.matchId}` : "Match unknown";
                            const byText = event.by && event.by !== "Unknown" ? ` • ${event.by}` : "";

                            return (
                              <div key={`${title}-cell-${index}-event-${eventIndex}`} className="rounded border border-zinc-800 bg-zinc-900/70 p-1.5">
                                <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                                  <span className="inline-flex items-center gap-1">
                                    <HeroIcon src={rowLeftIcon} alt={rowLeftLabel} width={14} height={14} className="h-3.5 w-3.5 rounded" />
                                    <span className="max-w-24 truncate">{rowLeftLabel}</span>
                                  </span>
                                  <span aria-hidden>⚔</span>
                                  <span className="inline-flex items-center gap-1">
                                    <HeroIcon src={rowRightIcon} alt={rowRightLabel} width={14} height={14} className="h-3.5 w-3.5 rounded" />
                                    <span className="max-w-24 truncate">{rowRightLabel}</span>
                                  </span>
                                </div>
                                <div className="mt-0.5 text-center text-[11px] text-zinc-300">{formatEventHeadline(event)}</div>
                                <div className="mt-0.5 text-center text-[10px] text-zinc-400">{matchLabel} • {formatTimeLabel(event.timeS)}{byText}</div>
                              </div>
                            );
                          })}
                        </div>

                        {cell.events.length > 12 ? (
                          <div className="mt-1 text-center text-[10px] text-zinc-500">+{cell.events.length - 12} more events in this cell</div>
                        ) : null}
                      </div>
                    ) : null}
                  </details>
                );
              })}
          </div>
          <img
            src="/assets/map/minimap_frame.webp"
            alt="Minimap frame"
            className="absolute inset-0 h-full w-full object-cover opacity-90 pointer-events-none"
          />
        </div>
      </div>
    </article>
  );
}

export default function MapHeatmap({ title, description, kills, deaths }: MapHeatmapProps) {
  const hasAnyData = kills.cells.length > 0 || deaths.cells.length > 0;
  const zoomOptions = [0.9, 1, 1.15] as const;
  const [zoom, setZoom] = useState<(typeof zoomOptions)[number]>(1);

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/60 p-1 text-[11px]">
          <span className="px-1 text-zinc-400">Zoom</span>
          {zoomOptions.map((option) => {
            const selected = option === zoom;
            const label = `${Math.round(option * 100)}%`;
            return (
              <button
                key={`zoom-${option}`}
                type="button"
                onClick={() => setZoom(option)}
                className={`rounded px-1.5 py-0.5 transition ${selected ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700"}`}
                aria-pressed={selected}
                aria-label={`Set heatmap zoom to ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mb-3 text-xs text-zinc-400">{description}</p>

      {hasAnyData ? (
        <div className="grid gap-3 md:grid-cols-2">
          <HeatmapCard
            title="Kill density"
            subtitle={`${kills.totalWeight.toFixed(0)} weighted kills`}
            series={kills}
            tone="emerald"
            zoom={zoom}
          />
          <HeatmapCard
            title="Death density"
            subtitle={`${deaths.totalWeight.toFixed(0)} weighted deaths`}
            series={deaths}
            tone="rose"
            zoom={zoom}
          />
        </div>
      ) : (
        <p className="text-sm text-zinc-400">No position snapshots found for this selection.</p>
      )}
    </section>
  );
}
