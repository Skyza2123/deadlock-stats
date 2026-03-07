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
  scrimDate: string;
  matches: ScrimMatch[];
  createdAt: string;
};

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

    return (parsed as ScrimEntry[])
      .map((entry) => {
        const normalizedDate = normalizeScrimDate(String(entry?.scrimDate ?? ""));
        return {
          ...entry,
          scrimDate: normalizedDate,
        };
      })
      .filter((entry) => Boolean(entry.id) && Boolean(entry.name));
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
