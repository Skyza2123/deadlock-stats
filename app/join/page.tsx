"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

function JoinPageContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl") || "/";
  const codeFromQuery = sp.get("code") || "";
  const { status } = useSession();

  const [inviteCode, setInviteCode] = useState(codeFromQuery);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (codeFromQuery) setInviteCode(codeFromQuery);
  }, [codeFromQuery]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const r = await fetch("/api/invite/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode, callbackUrl }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Invalid invite");
      setLoading(false);
      return;
    }

    const completeUrl = `/join/complete?callbackUrl=${encodeURIComponent(callbackUrl)}`;

    if (status === "authenticated") {
      router.push(completeUrl);
      return;
    }

    router.push(`/login?callbackUrl=${encodeURIComponent(completeUrl)}`);
  }

  return (
    <main className="min-h-screen w-full p-6 md:p-8">
      <div className="mx-auto grid w-full max-w-4xl gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="panel-premium relative overflow-hidden rounded-2xl p-6 md:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/12 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 -bottom-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

          <div className="relative z-10">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Team invite</p>
            <h1 className="heading-luxe mt-2 text-3xl font-bold tracking-tight">Join a team</h1>
            <p className="mt-2 text-sm text-zinc-400">Enter your invite code, then sign in if needed.</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Step 1</p>
                <p className="mt-1 text-sm font-medium">Enter invite code</p>
              </div>
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Step 2</p>
                <p className="mt-1 text-sm font-medium">Sign in if required</p>
              </div>
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Step 3</p>
                <p className="mt-1 text-sm font-medium">Get added to roster</p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel-premium rounded-2xl p-6 md:p-7">
          <h2 className="text-lg font-semibold">Invite code</h2>
          <p className="mt-1 text-xs text-zinc-500">Codes are case-insensitive and one-time validated.</p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="INV-AB12CD34"
              required
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-3 py-2.5 text-sm outline-none transition focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg border border-emerald-500/40 bg-emerald-700/90 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {loading ? "Checking..." : "Continue"}
            </button>
            {err ? <p className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full p-6 md:p-8">
          <div className="mx-auto w-full max-w-4xl">
            <section className="panel-premium rounded-2xl p-6 md:p-7">
              <h2 className="text-lg font-semibold">Invite code</h2>
              <p className="mt-1 text-xs text-zinc-500">Loading…</p>
            </section>
          </div>
        </main>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}