import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";

async function ensureSavedMatchesTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS saved_matches (
      steam_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (steam_id, match_id)
    )`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS saved_matches_steam_created_idx
     ON saved_matches (steam_id, created_at DESC)`
  );
}

function getSteamId(session: any) {
  return session?.user ? (session.user as any).id as string | undefined : undefined;
}

function normalizeDbUserKey(rawId: string) {
  const value = String(rawId ?? "").trim();
  if (!value) return "";
  if (value.startsWith("steam:")) return value.slice(6);
  if (value.startsWith("user:")) return value.slice(5);
  return value;
}

function viewerIdCandidates(rawId: string) {
  const ids = new Set<string>();
  const raw = String(rawId ?? "").trim();
  if (!raw) return [] as string[];
  ids.add(raw);
  const normalized = normalizeDbUserKey(raw);
  if (normalized) ids.add(normalized);
  return [...ids];
}

export async function GET() {
  const session = await getServerSession(authOptions as any);
  const steamId = getSteamId(session);
  const candidates = viewerIdCandidates(steamId ?? "");
  if (!candidates.length) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  await ensureSavedMatchesTable();

  const where = candidates.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await pool.query(
    `SELECT match_id, created_at
     FROM saved_matches
     WHERE steam_id IN (${where})
     ORDER BY created_at DESC`,
    candidates
  );

  return NextResponse.json({ saved: rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as any);
  const steamId = normalizeDbUserKey(getSteamId(session) ?? "");
  if (!steamId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  await ensureSavedMatchesTable();

  const body = await req.json().catch(() => null);
  const matchId = String(body?.matchId ?? "").trim();
  if (!matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  await pool.query(
    `INSERT INTO saved_matches (steam_id, match_id)
     VALUES ($1, $2)
     ON CONFLICT (steam_id, match_id) DO NOTHING`,
    [steamId, matchId]
  );

  return NextResponse.json({ ok: true });
}