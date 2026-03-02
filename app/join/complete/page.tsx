"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function JoinCompleteContent() {
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl") || "/";

  const [msg, setMsg] = useState("Linking your account to the team...");
  const [state, setState] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/invite/complete", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Something went wrong.");
        setState("error");
        return;
      }
      setMsg("✅ Joined team! Redirecting...");
      setState("success");
      setTimeout(() => window.location.assign(callbackUrl), 700);
    })();
  }, [callbackUrl]);

  return (
    <main className="min-h-screen w-full grid place-items-center p-6">
      <section className="panel-premium w-full max-w-md rounded-2xl p-6 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Invite status</p>
        <h1 className="heading-luxe mt-2 text-2xl font-bold">Team join</h1>
        <p
          className={`mt-3 text-sm ${
            state === "error"
              ? "text-rose-300"
              : state === "success"
                ? "text-emerald-300"
                : "text-zinc-300"
          }`}
        >
          {msg}
        </p>
      </section>
    </main>
  );
}

export default function JoinComplete() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full grid place-items-center p-6">
          <section className="panel-premium w-full max-w-md rounded-2xl p-6 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Invite status</p>
            <h1 className="heading-luxe mt-2 text-2xl font-bold">Team join</h1>
            <p className="mt-3 text-sm text-zinc-300">Loading…</p>
          </section>
        </main>
      }
    >
      <JoinCompleteContent />
    </Suspense>
  );
}