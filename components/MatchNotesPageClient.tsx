"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TabKey = "overview" | "timeline" | "lanes" | "charts" | "compare" | "notes" | "vod";

export default function MatchNotesPageClient({
  matchId,
  basePath,
}: {
  matchId: string;
  basePath: string;
}) {
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState<string | null>(null);

  const notesKey = `deadlock:match:notes:${matchId}`;

  useEffect(() => {
    try {
      setNotes(window.localStorage.getItem(notesKey) ?? "");
    } catch {
      setNotes("");
    }
  }, [notesKey]);

  function saveNotes() {
    try {
      window.localStorage.setItem(notesKey, notes);
      setNotesSaved("Notes saved.");
      setTimeout(() => setNotesSaved(null), 2000);
    } catch {
      setNotesSaved("Could not save notes.");
    }
  }

  const tabs: Array<{ key: TabKey; label: string; href: string }> = [
    { key: "overview", label: "Overview", href: basePath },
    { key: "timeline", label: "Timeline", href: `${basePath}/timeline` },
    { key: "lanes", label: "Lanes", href: `${basePath}/lanes` },
    { key: "charts", label: "Charts", href: `${basePath}/charts` },
    { key: "compare", label: "Compare", href: `${basePath}/compare` },
    { key: "notes", label: "Notes", href: `${basePath}/notes` },
    { key: "vod", label: "VOD", href: `${basePath}/vod` },
  ];

  return (
    <section className="space-y-3">
      <nav className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-2 py-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded px-2.5 py-1 text-[11px] transition ${
              tab.key === "notes"
                ? "border border-zinc-500/70 bg-zinc-800/80 text-zinc-100"
                : "border border-zinc-700/80 bg-zinc-900/70 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <section className="panel-premium rounded-xl p-4 md:p-5 space-y-3">
        <h2 className="text-base font-semibold">Notes</h2>

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Write match notes here..."
          className="min-h-44 w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveNotes}
            className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
          >
            Save notes
          </button>

          {notesSaved ? <span className="text-xs text-zinc-400">{notesSaved}</span> : null}
        </div>
      </section>
    </section>
  );
}