export default function PrivacyPage() {
  const updatedAt = "March 1, 2026";

  return (
    <main className="w-full p-6 md:p-8">
      <section className="panel-premium mx-auto max-w-3xl space-y-6 rounded-xl p-6">
        <header className="space-y-2 border-b border-zinc-800/80 pb-4">
          <h1 className="heading-luxe text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-zinc-400">Last updated: {updatedAt}</p>
        </header>

        <div className="space-y-4 text-sm text-zinc-300 leading-6">
          <p>
            Deadlock Stats stores only the account and match information needed to provide team analytics,
            roster management, and match review workflows.
          </p>
          <p>
            Authentication details are used to keep your workspace secure, and match data is used to
            generate performance insights for your team.
          </p>
        </div>

        <div className="panel-premium-soft rounded-lg p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Need help with your data?</h2>
          <p className="mt-2 text-sm text-zinc-400 leading-6">
            To request data removal or ask a privacy question, contact the app administrator and include
            your account email so we can process the request quickly.
          </p>
        </div>
      </section>
    </main>
  );
}
