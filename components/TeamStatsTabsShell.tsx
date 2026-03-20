"use client";

import { useEffect, useState } from "react";

type TeamStatsSectionId = "overview" | "performance" | "heroes" | "trends" | "items";

type TeamStatsTab = {
  id: TeamStatsSectionId;
  label: string;
};

export default function TeamStatsTabsShell({
  initialSection,
  tabs,
  from,
  to,
  children,
}: {
  initialSection: TeamStatsSectionId;
  tabs: readonly TeamStatsTab[];
  from?: string;
  to?: string;
  children: React.ReactNode;
}) {
  const [activeSection, setActiveSection] = useState<TeamStatsSectionId>(initialSection);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);

  useEffect(() => {
    query.set("section", activeSection);
    const url = new URL(window.location.href);
    url.search = query.toString();
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeSection]);

  return (
    <div className="team-stats-tabs-shell flex flex-col gap-4" data-active-section={activeSection}>
      <div role="tablist" aria-orientation="horizontal" className="team-tabs-list" tabIndex={0}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeSection === tab.id}
            aria-controls={`team-stats-panel-${tab.id}`}
            className={`team-tab-trigger ${activeSection === tab.id ? "team-tab-trigger-active" : ""}`}
            onClick={() => setActiveSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="team-stats-panels flex flex-col gap-5">{children}</div>
    </div>
  );
}
