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
    { key: "overview", label: "Overview", href: base },
    { key: "timeline", label: "Timeline", href: `${base}/timeline` },
    { key: "lanes", label: "Lanes", href: `${base}/lanes` },
    { key: "charts", label: "Charts", href: `${base}/charts` },
    { key: "compare", label: "Compare", href: `${base}/compare` },
    { key: "notes", label: "Notes", href: `${base}/notes` },
    { key: "vod", label: "VOD", href: `${base}/vod` },
  ];

  return (
    <nav className="match-shell-tabs inline-flex flex-wrap items-center gap-1 rounded-xl px-2 py-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`match-shell-tab rounded px-2.5 py-1 text-[11px] transition ${
            active === tab.key
              ? "match-shell-tab-active"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
