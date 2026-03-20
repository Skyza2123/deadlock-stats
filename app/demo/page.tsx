"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const DEMO_MATCH_ID = "68623064";

export default function DemoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/match/${DEMO_MATCH_ID}`);
  }, [router]);

  return (
    <main className="min-h-[90vh] w-full px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 text-center">
        <h1 className="text-2xl font-semibold text-zinc-100">Loading Demo Replay</h1>
        <p className="mt-2 text-sm text-zinc-400">Opening match {DEMO_MATCH_ID}...</p>
        <div className="mt-4">
          <Link href={`/match/${DEMO_MATCH_ID}`} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60">
            Open demo now
          </Link>
        </div>
      </div>
    </main>
  );
}
