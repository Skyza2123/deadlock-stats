import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";

function getSteamId(session: any) {
  return session?.user ? (session.user as any).id as string | undefined : undefined;
}

export async function GET() {
  const session = await getServerSession(authOptions as any);
  const steamId = getSteamId(session);
  if (!steamId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT match_id, created_at
     FROM saved_matches
     WHERE steam_id = $1
     ORDER BY created_at DESC`,
    [steamId]
  );

  return NextResponse.json({ saved: rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as any);
  const steamId = getSteamId(session);
  if (!steamId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

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