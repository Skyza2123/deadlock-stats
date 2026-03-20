"use client";

import Link from "next/link";

export default function DemoLanding() {
  const demoReplayId = "68623064";
  const cardBaseClass =
    "group relative overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-900/30 transition-all duration-200 hover:border-zinc-700/80 hover:bg-zinc-900/50";

  const primaryFeatures = [
    {
      title: "Scrim Analytics",
      description: "Track matches, analyze hero picks, and monitor team performance across scrims.",
      glowClass: "bg-blue-500/10",
      badgeClass: "bg-blue-500/20",
      iconClass: "text-blue-400",
      iconPath:
        "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    },
    {
      title: "Team Management",
      description: "Create teams, manage rosters, and collaborate with teammates seamlessly.",
      glowClass: "bg-emerald-500/10",
      badgeClass: "bg-emerald-500/20",
      iconClass: "text-emerald-400",
      iconPath:
        "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Real-time Insights",
      description: "Get instant statistics, heatmaps, and performance trends in real-time.",
      glowClass: "bg-blue-500/10",
      badgeClass: "bg-blue-500/20",
      iconClass: "text-blue-400",
      iconPath: "M13 10V3L4 14h7v7l9-11h-7z",
    },
  ];

  const statsCards = [
    { value: "40+", label: "Playable Heroes", valueClass: "text-emerald-400", glowClass: "bg-emerald-500/10" },
    { value: "Real-time", label: "Match Tracking", valueClass: "text-blue-400", glowClass: "bg-blue-500/10" },
    { value: "∞", label: "Free to Use", valueClass: "text-emerald-400", glowClass: "bg-emerald-500/10" },
  ];

  const demoFeatureList = [
    "Overview dashboard",
    "Timeline events",
    "Lane performance",
    "Charts and trends",
    "Player compare view",
    "Notes and VOD links",
  ];

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Hero Section */}
      <div className="relative w-full overflow-hidden px-4 py-12 sm:py-16 md:py-20 lg:py-28">
        {/* Gradient blobs for mobile optimization */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full bg-blue-500/10 blur-2xl sm:-right-48 sm:-top-48 sm:h-96 sm:w-96 sm:blur-3xl" />
        <div className="pointer-events-none absolute -left-32 bottom-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-2xl sm:-left-48 sm:h-96 sm:w-96 sm:blur-3xl" />

        <div className="relative mx-auto max-w-4xl">
          {/* Main Headline */}
          <div className="space-y-4 sm:space-y-6">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
              Deadlock{" "}
              <span className="bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Stats
              </span>
            </h1>

            <p className="max-w-2xl text-base text-zinc-400 sm:text-lg md:text-xl">
              Advanced scrim analytics and match insights for Deadlock teams. Track performance, analyze hero picks, and dominate your competitions.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:gap-4">
            <Link
              href="/demo"
              className="inline-flex items-center justify-center rounded-lg bg-linear-to-r from-blue-600 to-blue-500 px-6 py-3 font-semibold text-white transition-all duration-200 hover:from-blue-700 hover:to-blue-600 active:scale-95 sm:px-8 sm:py-4"
            >
              Try Demo
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-900/30 px-6 py-3 font-semibold text-emerald-200 transition-all duration-200 hover:border-emerald-400/60 hover:bg-emerald-800/40 sm:px-8 sm:py-4"
            >
              Sign In
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/50 px-6 py-3 font-semibold text-zinc-100 transition-all duration-200 hover:border-zinc-600 hover:bg-zinc-800/50 sm:px-8 sm:py-4"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section id="features" className="relative w-full px-4 py-12 sm:py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center sm:mb-16">
            <h2 className="text-3xl font-bold text-white sm:text-4xl md:text-5xl">
              Powerful Features
            </h2>
            <p className="mt-4 text-zinc-400 sm:text-lg">
              Everything you need to analyze and improve your team's performance
            </p>
          </div>

          {/* Feature Grid - Mobile responsive */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {primaryFeatures.map((feature) => (
              <div key={feature.title} className={`${cardBaseClass} p-6 sm:p-8`}>
                <div className={`absolute -right-12 -top-12 h-32 w-32 rounded-full ${feature.glowClass} blur-2xl transition-all duration-200 group-hover:blur-3xl`} />
                <div className="relative">
                  <div className={`mb-4 inline-flex rounded-lg ${feature.badgeClass} p-3`}>
                    <svg className={`h-6 w-6 ${feature.iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={feature.iconPath} />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-white sm:text-xl">{feature.title}</h3>
                  <p className="mt-2 text-sm text-zinc-400 sm:text-base">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section - Mobile optimized */}
      <section className="relative w-full px-4 py-12 sm:py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-3">
            {statsCards.map((stat) => (
              <div key={stat.label} className={`${cardBaseClass} p-6 text-center sm:p-8`}>
                <div className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full ${stat.glowClass} blur-2xl`} />
                <div className={`relative text-3xl font-bold sm:text-4xl ${stat.valueClass}`}>{stat.value}</div>
                <p className="relative mt-2 text-sm text-zinc-400 sm:text-base">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <h3 className="text-center text-2xl font-bold text-white sm:text-3xl">Features</h3>
            <p className="mt-2 text-center text-sm text-zinc-400 sm:text-base">
              Built-in analysis views available in the live demo match.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {demoFeatureList.map((feature, index) => (
                <div
                  key={feature}
                  className={`${cardBaseClass} p-5`}
                >
                  <div
                    className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full ${index % 2 === 0 ? "bg-blue-500/10" : "bg-emerald-500/10"} blur-2xl transition-all duration-200 group-hover:blur-3xl`}
                  />
                  <p className="relative text-sm font-medium text-zinc-100 sm:text-base">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative w-full px-4 py-12 sm:py-16 md:py-20">
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-blue-500/5 to-emerald-500/5 blur-3xl" />
        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to dominate?
          </h2>
          <p className="mt-4 text-zinc-400 sm:text-lg">
            Start analyzing your Deadlock scrims today and elevate your team's performance.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex items-center justify-center rounded-lg bg-linear-to-r from-blue-600 to-blue-500 px-8 py-3 font-semibold text-white transition-all duration-200 hover:from-blue-700 hover:to-blue-600 active:scale-95 sm:px-10 sm:py-4"
          >
            Sign In Now
          </Link>
        </div>
      </section>
    </div>
  );
}
