"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function LoginPageContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const { status } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [steamAvailable, setSteamAvailable] = useState(false);
  const [credentialsAvailable, setCredentialsAvailable] = useState(false);

  useEffect(() => {
    if (status === "authenticated") window.location.assign(callbackUrl);
  }, [status, callbackUrl]);

  useEffect(() => {
    let active = true;

    async function checkProviders() {
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" });
        const providers = await res.json().catch(() => ({}));
        if (!active) return;
        setSteamAvailable(Boolean(providers?.steam));
        setCredentialsAvailable(Boolean(providers?.credentials));
      } catch {
        if (!active) return;
        setSteamAvailable(false);
        setCredentialsAvailable(false);
      }
    }

    checkProviders();
    return () => {
      active = false;
    };
  }, []);

  async function onSteamSignIn() {
    setLoading(true);
    setError(null);

    const result = await signIn("steam", {
      redirect: false,
      callbackUrl,
    });

    if (result?.error || !result?.ok || !result?.url) {
      setError("Steam sign in failed. Check STEAM_SECRET and NEXTAUTH_URL.");
      setLoading(false);
      return;
    }

    window.location.assign(result.url);
  }

  async function onCredentialsSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.error || !result?.ok) {
      setError("Fallback sign in failed. Check email/password.");
      setLoading(false);
      return;
    }

    window.location.assign(result.url || callbackUrl);
  }

  return (
    <main className="min-h-screen w-full p-6 md:p-8">
      <div className="mx-auto grid w-full max-w-4xl gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="panel-premium relative overflow-hidden rounded-2xl p-6 md:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/12 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 -bottom-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

          <div className="relative z-10">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Deadlock Stats</p>
            <h1 className="heading-luxe mt-2 text-3xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Steam is the primary login. Credentials are available as a fallback.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Fast access</p>
                <p className="mt-1 text-sm font-medium">Steam SSO</p>
              </div>
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Team tools</p>
                <p className="mt-1 text-sm font-medium">Invites + roster</p>
              </div>
              <div className="panel-premium-soft rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide opacity-70">Secure</p>
                <p className="mt-1 text-sm font-medium">Session protected</p>
              </div>
            </div>

            <div className="mt-6 text-sm text-zinc-400">
              <a
                className="underline decoration-zinc-500/60 underline-offset-4 hover:text-zinc-200"
                href={`/join?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              >
                Join a team with an invite code
              </a>
            </div>
          </div>
        </section>

        <section className="panel-premium rounded-2xl p-6 md:p-7">
          <h2 className="text-lg font-semibold">Account access</h2>
          <p className="mt-1 text-xs text-zinc-500">Choose a sign-in method to continue.</p>

          {status === "authenticated" ? (
            <p className="mt-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">Signed in. Redirecting...</p>
          ) : null}

          <div className="mt-5 space-y-4">
            {error ? <p className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}

            <div className="panel-premium-soft rounded-xl p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">Recommended</p>
              {steamAvailable ? (
                <button
                  type="button"
                  onClick={onSteamSignIn}
                  disabled={loading}
                  className="w-full rounded-lg border border-emerald-500/40 bg-emerald-700/90 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                  {loading ? "Redirecting to Steam..." : "Sign in with Steam"}
                </button>
              ) : (
                <p className="text-sm text-amber-300">Steam sign-in is not configured.</p>
              )}
            </div>

            {credentialsAvailable ? (
              <form className="panel-premium-soft space-y-3 rounded-xl p-3" onSubmit={onCredentialsSignIn}>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Login</p>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                  className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg border border-emerald-500/40 bg-emerald-700/90 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                  {loading ? "Signing in..." : "Sign in with credentials"}
                </button>
              </form>
            ) : (
              <p className="text-sm text-zinc-400">
                Credentials fallback not enabled (set AUTH_EMAIL / AUTH_PASSWORD).
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full grid place-items-center p-6">
          <section className="panel-premium w-full max-w-md rounded-2xl p-6">
            <h1 className="heading-luxe text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-2 text-sm text-zinc-400">Loading sign-in options...</p>
          </section>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}