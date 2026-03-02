"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type RecentMatchRow = {
  matchId: string;
  winnerKey: string;
  winner: string;
  durationText: string;
  durationSeconds: number;
  scrimDateSet: boolean;
  bansUploaded: boolean;
  top: {
    displayName: string | null;
    heroName: string;
    netWorth: number;
    killAssist: number;
  } | null;
  ingestedAtText: string;
};

type Props = {
  rows: RecentMatchRow[];
  viewerKey: string;
};

const HOME_RESULT_GROUP_STORAGE_KEY = "deadlock-home-result-group";

function storageKey(viewerKey: string) {
  return `removed-recent-matches:${viewerKey}`;
}

export default function HomeRecentPanel({ rows, viewerKey }: Props) {
  const router = useRouter();
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [resultGroup, setResultGroup] = useState<"0" | "1">("0");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(viewerKey));
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setRemovedIds(new Set(parsed.filter((value): value is string => typeof value === "string")));
    } catch {
      setRemovedIds(new Set());
    }
  }, [viewerKey]);

  useEffect(() => {
    const savedResultGroup = window.localStorage.getItem(HOME_RESULT_GROUP_STORAGE_KEY);
    if (savedResultGroup === "0" || savedResultGroup === "1") {
      setResultGroup(savedResultGroup);
      return;
    }

    setResultGroup("0");
  }, []);

  function persist(next: Set<string>) {
    setRemovedIds(next);
    window.localStorage.setItem(storageKey(viewerKey), JSON.stringify([...next]));
  }

  function setPerspective(next: "0" | "1") {
    setResultGroup(next);
    window.localStorage.setItem(HOME_RESULT_GROUP_STORAGE_KEY, next);
  }

  function removeMatch(matchId: string) {
    const confirmed = window.confirm(`Remove match ${matchId} from your recent view?`);
    if (!confirmed) return;

    const next = new Set(removedIds);
    next.add(matchId);
    persist(next);
  }

  function resultText(row: RecentMatchRow) {
    return row.winnerKey === resultGroup ? "Won" : "Lost";
  }

  const combinedRows = useMemo(() => rows, [rows]);

  const visibleRows = useMemo(
    () => combinedRows.filter((row) => !removedIds.has(row.matchId)),
    [combinedRows, removedIds]
  );

  const hiddenCount = combinedRows.length - visibleRows.length;

  return (
    <>
      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 backdrop-blur-sm p-5">
        <div className="mb-3 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="text-lg font-semibold">Recent matches</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-900/70 p-1 text-xs">
              <button
                type="button"
                onClick={() => setPerspective("0")}
                className={`rounded px-2 py-1 ${resultGroup === "0" ? "bg-zinc-700/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Hidden King POV
              </button>
              <button
                type="button"
                onClick={() => setPerspective("1")}
                className={`rounded px-2 py-1 ${resultGroup === "1" ? "bg-zinc-700/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Archmother POV
              </button>
            </div>

            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => persist(new Set())}
                className="rounded border border-zinc-700/80 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Restore hidden ({hiddenCount})
              </button>
            ) : null}
          </div>
        </div>

        {visibleRows.length ? (
          <>
            <div className="space-y-2 md:hidden">
              {visibleRows.map((m) => (
                <article
                  key={m.matchId}
                  className="rounded-lg border border-zinc-800/70 bg-zinc-900/20 p-3 cursor-pointer hover:bg-zinc-900/35"
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/match/${m.matchId}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/match/${m.matchId}`);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm">{m.matchId}</p>
                    <span className="text-xs opacity-80">{resultText(m)}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{m.ingestedAtText}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className={`rounded px-2 py-0.5 border ${m.scrimDateSet ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300"}`}>
                      {m.scrimDateSet ? "✓ Scrim date" : "• Scrim date"}
                    </span>
                    <span className={`rounded px-2 py-0.5 border ${m.bansUploaded ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300"}`}>
                      {m.bansUploaded ? "✓ Bans uploaded" : "• Bans uploaded"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <a className="text-xs text-emerald-300 hover:text-emerald-200 hover:underline" href={`/match/${m.matchId}`}>
                      View →
                    </a>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeMatch(m.matchId);
                      }}
                      className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-lg border border-zinc-800/70 md:block">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/80">
                  <tr>
                    <th className="p-3 text-left">Match</th>
                    <th className="p-3 text-left">Result</th>
                    <th className="p-3 text-left">Ingested</th>
                    <th className="p-3 text-left">Checklist</th>
                    <th className="p-3 text-left">Open</th>
                    <th className="p-3 text-left">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((m) => (
                    <tr
                      key={m.matchId}
                      className="border-t border-zinc-800/80 odd:bg-zinc-900/20 align-top cursor-pointer hover:bg-zinc-900/40"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/match/${m.matchId}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/match/${m.matchId}`);
                        }
                      }}
                    >
                      <td className="p-3 font-mono">{m.matchId}</td>
                      <td className="p-3">{resultText(m)}</td>
                      <td className="p-3">{m.ingestedAtText}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5 text-[11px]">
                          <span className={`rounded px-2 py-0.5 border ${m.scrimDateSet ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300"}`}>
                            {m.scrimDateSet ? "✓ Date" : "• Date"}
                          </span>
                          <span className={`rounded px-2 py-0.5 border ${m.bansUploaded ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300"}`}>
                            {m.bansUploaded ? "✓ Bans" : "• Bans"}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <a className="text-emerald-300 hover:text-emerald-200 hover:underline" href={`/match/${m.matchId}`}>
                          View →
                        </a>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeMatch(m.matchId);
                          }}
                          className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="opacity-80">No recent matches in your current view.</p>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => persist(new Set())}
                className="rounded border border-zinc-700/80 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Restore hidden matches ({hiddenCount})
              </button>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}
