"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="rounded border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800/90"
    >
      ← Back
    </button>
  );
}