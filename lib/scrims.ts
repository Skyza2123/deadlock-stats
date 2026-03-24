export const SCRIM_STORAGE_KEY = "deadlock-scrim-dashboard";

export type ScrimMatch = {
  matchId: string;
  bansUploaded: boolean;
  uploadedAt: string;
};

export type ScrimAssignment = "team" | "individual";

export type ScrimEntry = {
  id: string;
  name: string;
  assignment: ScrimAssignment;
  teamSlug: string;
  teamName: string;
  enemyTeamName?: string;
  scrimDate: string;
  isPublic: boolean;
  matches: ScrimMatch[];
  createdAt: string;
};

function normalizeMatches(value: unknown) {
  if (!Array.isArray(value)) return [] as ScrimMatch[];

  return value
    .map((row) => {
      const entry = row as Partial<ScrimMatch>;
      const matchId = String(entry?.matchId ?? "").trim();
      if (!matchId) return null;
      return {
        matchId,
        bansUploaded: Boolean(entry?.bansUploaded),
        uploadedAt: String(entry?.uploadedAt ?? new Date().toISOString()),
      } satisfies ScrimMatch;
    })
    .filter((entry): entry is ScrimMatch => Boolean(entry));
}

export function normalizeScrimEntry(value: unknown): ScrimEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ScrimEntry>;

  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  const assignment: ScrimAssignment = String(row.assignment ?? "team").trim().toLowerCase() === "individual" ? "individual" : "team";
  const teamSlug = assignment === "team" ? String(row.teamSlug ?? "").trim() : "";
  const teamName = assignment === "team" ? String(row.teamName ?? teamSlug).trim() : "Individual";
  const enemyTeamName = assignment === "team" ? String((row as any).enemyTeamName ?? "").trim() : "";
  const scrimDate = normalizeScrimDate(String(row.scrimDate ?? ""));
  const isPublic = Boolean(row.isPublic);
  const matches = normalizeMatches((row as any).matches);
  const createdAt = String(row.createdAt ?? new Date().toISOString());

  if (!id || !name || !scrimDate) return null;
  if (assignment === "team" && !teamSlug) return null;

  return {
    id,
    name,
    assignment,
    teamSlug,
    teamName,
    enemyTeamName,
    scrimDate,
    isPublic,
    matches,
    createdAt,
  };
}

export function normalizeScrimDate(value: string, fallback = "") {
  const trimmed = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return fallback;
}

export function readScrimsFromStorage() {
  if (typeof window === "undefined") return [] as ScrimEntry[];

  try {
    const raw = window.localStorage.getItem(SCRIM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return (parsed as unknown[])
      .map((entry) => normalizeScrimEntry(entry))
      .filter((entry): entry is ScrimEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function writeScrimsToStorage(scrims: ScrimEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCRIM_STORAGE_KEY, JSON.stringify(scrims));
}

export function formatScrimDate(scrimDate: string) {
  const value = String(scrimDate ?? "").trim();
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return value;

  const [year, month, day] = parts;
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(utcDate);
}

export async function fetchScrimsFromApi() {
  const res = await fetch("/api/scrims", { cache: "no-store" });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok || !Array.isArray(data?.scrims)) {
    throw new Error(String(data?.error ?? `Failed to load scrims (${res.status})`));
  }

  return (data.scrims as unknown[])
    .map((entry) => normalizeScrimEntry(entry))
    .filter((entry): entry is ScrimEntry => Boolean(entry));
}

export async function createScrimInApi(scrim: ScrimEntry) {
  const res = await fetch("/api/scrims", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scrim),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(String(data?.error ?? `Failed to create scrim (${res.status})`));
  }
}

export async function updateScrimInApi(scrim: ScrimEntry) {
  const res = await fetch("/api/scrims", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scrim),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(String(data?.error ?? `Failed to update scrim (${res.status})`));
  }
}

export async function deleteScrimInApi(id: string) {
  const res = await fetch("/api/scrims", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(String(data?.error ?? `Failed to delete scrim (${res.status})`));
  }
}
