export default function PrivacyPage() {
  return (
    <main className="w-full p-6 md:p-8">
      <section className="panel-premium mx-auto max-w-3xl rounded-xl p-6 space-y-4">
        <h1 className="heading-luxe text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-zinc-300">
          This app stores account and match data needed to provide team analytics features.
          Data is used only for authentication, roster management, and match insights.
        </p>
        <p className="text-sm text-zinc-400">
          If you need your data removed or have privacy questions, contact the app administrator.
        </p>
      </section>
    </main>
  );
}
