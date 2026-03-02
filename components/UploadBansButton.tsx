"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  matchId: string;
  initialBanCount: number;
};

export default function UploadBansButton({ matchId, initialBanCount }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [bansFile, setBansFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    initialBanCount > 0 ? `Bans uploaded (${initialBanCount}).` : null,
  );

  async function uploadBans() {
    if (!matchId.trim()) return;
    if (!bansFile) {
      setError("Choose a bans JSON file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append("matchId", matchId.trim());
      fd.append("bansFile", bansFile);

      const res = await fetch("/api/ingest-bans", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(
          data?.details
            ? `${data?.error ?? "Bans upload failed"}: ${data.details}`
            : (data?.error ?? `Bans upload failed (${res.status})`),
        );
        return;
      }

      const count = Number(data?.banCount ?? 0);
      setNotice(`Bans uploaded${count > 0 ? ` (${count})` : ""}.`);
      setBansFile(null);
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          setBansFile(event.target.files?.[0] ?? null);
          setError(null);
          setNotice(null);
        }}
        className="block w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-xs"
      />
      <button
        type="button"
        onClick={() => void uploadBans()}
        disabled={loading || !bansFile}
        className="rounded border border-amber-500/40 bg-amber-700/90 px-4 py-2 text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
      >
        {loading ? "Uploading bans..." : "Upload bans"}
      </button>
      {bansFile ? <p className="text-xs text-zinc-400">Selected: {bansFile.name}</p> : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-amber-300">{notice}</p> : null}
    </div>
  );
}
