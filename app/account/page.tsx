import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";

function resolveAccountId(rawId: string) {
  if (rawId.startsWith("user:")) return rawId.slice(5);
  if (rawId.startsWith("steam:")) return rawId.slice(6);
  return rawId;
}

export default async function AccountPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <section className="panel-premium rounded-xl p-5 md:p-6">
          <h1 className="heading-luxe text-2xl font-bold">Account</h1>
          <p className="mt-2 text-zinc-400">You are not signed in.</p>
          <a
            href="/login"
            className="mt-4 inline-block rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            Go to login
          </a>
        </section>
      </main>
    );
  }

  const rawId = String((session.user as { id?: string } | undefined)?.id ?? "");
  const accountId = resolveAccountId(rawId);

  return (
    <main className="w-full p-6 md:p-8 space-y-6">
      <header className="panel-premium relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Profile</p>
          <h1 className="heading-luxe mt-2 text-3xl font-bold tracking-tight">Account</h1>
          <p className="mt-2 text-sm text-zinc-400">Manage your login and team invite actions.</p>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel-premium rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="grid gap-2 text-sm">
            <div className="panel-premium-soft rounded-lg px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide opacity-70">Name</p>
              <p className="mt-1 text-zinc-200">{session.user?.name ?? "-"}</p>
            </div>
            <div className="panel-premium-soft rounded-lg px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide opacity-70">Email</p>
              <p className="mt-1 text-zinc-200 break-all">{session.user?.email ?? "-"}</p>
            </div>
            <div className="panel-premium-soft rounded-lg px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide opacity-70">Account ID</p>
              <p className="mt-1 font-mono text-zinc-300">{accountId || "-"}</p>
            </div>
          </div>
        </article>

        <article className="panel-premium rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold">Team Invites</h2>
          <p className="text-sm text-zinc-400">Use an invite code to join a team.</p>
          <a
            href="/join"
            className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Join team with code
          </a>
        </article>
      </section>
    </main>
  );
}
