import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";

type ScrimAssignment = "team" | "individual";

type ScrimMatch = {
  matchId: string;
  bansUploaded: boolean;
  uploadedAt: string;
};

type ScrimPayload = {
  id: string;
  name: string;
  assignment: ScrimAssignment;
  teamSlug: string;
  teamName: string;
  scrimDate: string;
  isPublic: boolean;
  matches: ScrimMatch[];
  createdAt?: string;
};

function normalizeUserId(value: unknown) {
  return String(value ?? "").trim();
}

function ownerIdFromSession(session: any) {
  return normalizeUserId(session?.user?.id);
}

function normalizeDate(value: unknown, fallback = "") {
  const trimmed = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return fallback;
}

function normalizeAssignment(value: unknown): ScrimAssignment {
  return String(value ?? "").trim().toLowerCase() === "individual" ? "individual" : "team";
}

function normalizeMatches(value: unknown): ScrimMatch[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const row = entry as Partial<ScrimMatch>;
      const matchId = String(row?.matchId ?? "").trim();
      if (!matchId) return null;
      return {
        matchId,
        bansUploaded: Boolean(row?.bansUploaded),
        uploadedAt: String(row?.uploadedAt ?? new Date().toISOString()),
      } satisfies ScrimMatch;
    })
    .filter((entry): entry is ScrimMatch => Boolean(entry));
}

function normalizePayload(input: unknown): ScrimPayload | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<ScrimPayload>;

  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  const assignment = normalizeAssignment(row.assignment);
  const teamSlug = assignment === "team" ? String(row.teamSlug ?? "").trim() : "";
  const teamName = assignment === "team" ? String(row.teamName ?? teamSlug).trim() : "Individual";
  const scrimDate = normalizeDate(row.scrimDate);
  const isPublic = Boolean(row.isPublic);
  const matches = normalizeMatches(row.matches);
  const createdAt = String(row.createdAt ?? "").trim();

  if (!id || !name || !scrimDate) return null;
  if (assignment === "team" && !teamSlug) return null;

  return {
    id,
    name,
    assignment,
    teamSlug,
    teamName,
    scrimDate,
    isPublic,
    matches,
    createdAt,
  };
}

async function ensureScrimsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS scrims (
      scrim_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      assignment_type TEXT NOT NULL,
      team_slug TEXT NOT NULL DEFAULT '',
      team_name TEXT NOT NULL DEFAULT '',
      scrim_date TEXT NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT true,
      matches JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS scrims_owner_idx
     ON scrims (owner_id, created_at DESC)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS scrims_owner_public_idx
     ON scrims (owner_id, is_public, created_at DESC)`
  );
}

export async function GET() {
  const session: any = await getServerSession(authOptions as any);
  const ownerId = ownerIdFromSession(session);
  if (!ownerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  await ensureScrimsTable();

  const { rows } = await pool.query(
    `SELECT
      scrim_id,
      name,
      assignment_type,
      team_slug,
      team_name,
      scrim_date,
      is_public,
      matches,
      created_at
     FROM scrims
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId]
  );

  const scrims = rows.map((row) => ({
    id: String(row.scrim_id),
    name: String(row.name),
    assignment: normalizeAssignment(row.assignment_type),
    teamSlug: String(row.team_slug ?? ""),
    teamName: String(row.team_name ?? ""),
    scrimDate: normalizeDate(row.scrim_date),
    isPublic: Boolean(row.is_public),
    matches: normalizeMatches(row.matches),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? new Date().toISOString()),
  }));

  return NextResponse.json({ ok: true, scrims });
}

export async function POST(req: NextRequest) {
  const session: any = await getServerSession(authOptions as any);
  const ownerId = ownerIdFromSession(session);
  if (!ownerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const payload = normalizePayload(body);
  if (!payload) {
    return NextResponse.json({ error: "Invalid scrim payload" }, { status: 400 });
  }

  await ensureScrimsTable();

  const createdAt = payload.createdAt || new Date().toISOString();

  await pool.query(
    `INSERT INTO scrims (
      scrim_id, owner_id, name, assignment_type, team_slug, team_name, scrim_date, is_public, matches, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, now()
    )
    ON CONFLICT (scrim_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      assignment_type = EXCLUDED.assignment_type,
      team_slug = EXCLUDED.team_slug,
      team_name = EXCLUDED.team_name,
      scrim_date = EXCLUDED.scrim_date,
      is_public = EXCLUDED.is_public,
      matches = EXCLUDED.matches,
      updated_at = now()
    WHERE scrims.owner_id = EXCLUDED.owner_id`,
    [
      payload.id,
      ownerId,
      payload.name,
      payload.assignment,
      payload.teamSlug,
      payload.teamName,
      payload.scrimDate,
      payload.isPublic,
      JSON.stringify(payload.matches),
      createdAt,
    ]
  );

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const session: any = await getServerSession(authOptions as any);
  const ownerId = ownerIdFromSession(session);
  if (!ownerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const payload = normalizePayload(body);
  if (!payload) {
    return NextResponse.json({ error: "Invalid scrim payload" }, { status: 400 });
  }

  await ensureScrimsTable();

  const result = await pool.query(
    `UPDATE scrims
     SET
       name = $3,
       assignment_type = $4,
       team_slug = $5,
       team_name = $6,
       scrim_date = $7,
       is_public = $8,
       matches = $9::jsonb,
       updated_at = now()
     WHERE scrim_id = $1 AND owner_id = $2`,
    [
      payload.id,
      ownerId,
      payload.name,
      payload.assignment,
      payload.teamSlug,
      payload.teamName,
      payload.scrimDate,
      payload.isPublic,
      JSON.stringify(payload.matches),
    ]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Scrim not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session: any = await getServerSession(authOptions as any);
  const ownerId = ownerIdFromSession(session);
  if (!ownerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const scrimId = String(body?.id ?? "").trim();
  if (!scrimId) {
    return NextResponse.json({ error: "Missing scrim id" }, { status: 400 });
  }

  await ensureScrimsTable();

  const result = await pool.query(
    `DELETE FROM scrims WHERE scrim_id = $1 AND owner_id = $2`,
    [scrimId, ownerId]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Scrim not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
