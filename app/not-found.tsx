import Link from "next/link";

export default function NotFound() {
  return (
    <main className="w-full p-6 md:p-8">
      <section className="panel-premium mx-auto max-w-2xl rounded-xl p-6 text-center">
        <p className="text-xs uppercase tracking-wide opacity-70">404</p>
        <h1 className="heading-luxe mt-2 text-3xl font-bold">Under construction</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This page is not ready yet.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Go home
        </Link>
      </section>
    </main>
  );
}
