import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { db } from "../../../db";
import { matches } from "../../../db/schema";
import { authOptions } from "../../../lib/auth";

type BanRow = {
  heroId: string | null;
  side: string | null;
  order: number;
  raw: unknown;
};

type DraftEventRow = {
  heroId: string | null;
  side: string | null;
  order: number;
  type: "pick" | "ban";
  raw: unknown;
};

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeSide(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;

  if (raw === "team1" || raw === "t1") return "0";
  if (raw === "team2" || raw === "t2") return "1";

  if (raw === "hidden king") return "0";
  if (raw === "archmother") return "1";

  if (raw === "0" || raw === "1") return raw;
  return String(value);
}

function parseBanArray(items: unknown[]) {
  return parseDraftArray(items)
    .filter((row) => row.type === "ban")
    .map((row) => ({
      heroId: row.heroId,
      side: row.side,
      order: row.order,
      raw: row.raw,
    } satisfies BanRow));
}

function parseDraftArray(items: unknown[]) {
  return items
    .map((entry, index) => {
      const item = toObject(entry);
      const typeRaw = String(item.type ?? item.event_type ?? "").toLowerCase();
      let eventType: "pick" | "ban" | null = null;
      if (typeRaw === "pick" || typeRaw === "ban") {
        eventType = typeRaw;
      } else if (item.ban_hero_id != null) {
        eventType = "ban";
      } else if (item.pick_hero_id != null) {
        eventType = "pick";
      }

      if (!eventType) return null;

      const heroIdRaw =
        item.hero_id ?? item.heroId ?? item.ban_hero_id ?? item.pick_hero_id ?? item.character_id ?? item.id ?? null;
      const sideRaw = item.team ?? item.side ?? item.team_id ?? item.faction ?? item.teamId ?? null;
      const orderRaw = item.order ?? item.ban_order ?? item.phase ?? item.id ?? index + 1;

      return {
        heroId: heroIdRaw != null ? String(heroIdRaw) : null,
        side: normalizeSide(sideRaw),
        order: Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : index + 1,
        type: eventType,
        raw: entry,
      } satisfies DraftEventRow;
    })
    .filter((row): row is DraftEventRow => Boolean(row?.heroId));
}

function extractBans(payload: unknown): BanRow[] {
  return extractDraftEvents(payload)
    .filter((event) => event.type === "ban")
    .map((event) => ({
      heroId: event.heroId,
      side: event.side,
      order: event.order,
      raw: event.raw,
    }));
}

function extractDraftEvents(payload: unknown): DraftEventRow[] {
  if (Array.isArray(payload)) {
    return parseDraftArray(payload).sort((a, b) => a.order - b.order);
  }

  const root = toObject(payload);
  const matchInfo = toObject(root.match_info);
  const draft = toObject(root.draft);

  const candidateArrays = [
    asArray(matchInfo.bans),
    asArray(matchInfo.hero_bans),
    asArray(root.bans),
    asArray(root.hero_bans),
    asArray(root.pick_bans),
    asArray(draft.bans),
    asArray(draft.events),
    asArray(root.draft_events),
    asArray(root.timeline),
  ].filter((arr) => arr.length > 0);

  let best: DraftEventRow[] = [];
  for (const candidate of candidateArrays) {
    const parsed = parseDraftArray(candidate);
    if (parsed.length > best.length) best = parsed;
  }

  return [...best].sort((a, b) => a.order - b.order);
}

function mergeRawWithBans(rawJson: unknown, bans: BanRow[], draftEvents: DraftEventRow[], source: unknown) {
  const root = toObject(rawJson);
  const matchInfo = toObject(root.match_info);

  const banPayload = {
    source,
    count: bans.length,
    rows: bans,
    updatedAt: new Date().toISOString(),
  };

  const draftPayload = {
    source,
    count: draftEvents.length,
    rows: draftEvents,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...root,
    match_info: {
      ...matchInfo,
      bans: bans.map((ban) => ({
        hero_id: ban.heroId,
        side: ban.side,
        order: ban.order,
      })),
    },
    separateBans: banPayload,
    separateDraft: draftPayload,
  };
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
    }

    const form = await req.formData();
    const matchId = String(form.get("matchId") ?? "").trim();
    const bansFile = form.get("bansFile");

    if (!matchId) {
      return NextResponse.json({ ok: false, error: "Missing matchId" }, { status: 400 });
    }

    if (!(bansFile instanceof File) || bansFile.size === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing bans file", details: "Upload a JSON draft file." },
        { status: 400 },
      );
    }

    const existing = await db
      .select({ rawJson: matches.rawJson })
      .from(matches)
      .where(eq(matches.matchId, matchId))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json(
        { ok: false, error: "Match not found", details: "Ingest the match first, then upload bans." },
        { status: 404 },
      );
    }

    let uploadedPayload: unknown;
    try {
      const text = await bansFile.text();
      uploadedPayload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid bans file", details: "File must be valid JSON." },
        { status: 400 },
      );
    }

    const draftEvents = extractDraftEvents(uploadedPayload);
    const bans = draftEvents
      .filter((event) => event.type === "ban")
      .map((event) => ({
        heroId: event.heroId,
        side: event.side,
        order: event.order,
        raw: event.raw,
      } satisfies BanRow));

    if (!draftEvents.length) {
      return NextResponse.json(
        { ok: false, error: "No draft events found", details: "File must include pick/ban draft events." },
        { status: 404 },
      );
    }

    if (!bans.length) {
      return NextResponse.json(
        { ok: false, error: "No bans found", details: "File did not contain ban entries." },
        { status: 404 },
      );
    }

    const existingRaw = existing[0].rawJson;
    const mergedRaw = mergeRawWithBans(existingRaw, bans, draftEvents, "upload");

    await db
      .update(matches)
      .set({
        rawJson: mergedRaw,
        ingestedAt: new Date(),
        saved: 1,
      })
      .where(eq(matches.matchId, matchId));

    return NextResponse.json({
      ok: true,
      saved: true,
      matchId,
      banCount: bans.length,
      draftCount: draftEvents.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Server error", details: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
