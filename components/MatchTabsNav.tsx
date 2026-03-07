import Link from "next/link";

import type { MatchTabKey } from "../lib/matchExperienceData";

export default function MatchTabsNav({
  matchId,
  active,
}: {
  matchId: string;
  active: MatchTabKey;
}) {
  const base = `/match/${matchId}`;

  const tabs: Array<{ key: MatchTabKey; label: string; href: string }> = [
    { key: "overview", label: "Overview (main page)", href: base },
    { key: "timeline", label: "Timeline", href: `${base}/timeline` },
    { key: "lanes", label: "Lanes", href: `${base}/lanes` },
    { key: "charts", label: "Charts", href: `${base}/charts` },
    { key: "compare", label: "Compare", href: `${base}/compare` },
    { key: "notes", label: "Notes", href: `${base}/notes` },
    { key: "vod", label: "VOD", href: `${base}/vod` },
  ];

  return (
    <nav className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-2 py-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded px-2.5 py-1 text-[11px] transition ${
            active === tab.key
              ? "border border-zinc-500/70 bg-zinc-800/80 text-zinc-100"
              : "border border-zinc-700/80 bg-zinc-900/70 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
