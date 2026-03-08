import { ITEMS } from "./deadlockData";

const itemIconCache = new Map<number, string | null>();

function candidateBaseNames(itemDisplayName: string) {
  const normalized = itemDisplayName
    .normalize("NFKD")
    .replace(/[’']/g, "_")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const names = new Set<string>();
  if (normalized) {
    names.add(normalized);
    names.add(normalized.replace(/-/g, "_"));
    names.add(normalized.replace(/_/g, "-"));
  }

  return [...names].filter(Boolean);
}

function preferredItemIconFile(itemDisplayName: string) {
  const candidates = candidateBaseNames(itemDisplayName);
  if (!candidates.length) return null;
  return `${candidates[0]}.webp`;
}

export function itemIconPath(itemId: number | null | undefined) {
  if (typeof itemId !== "number" || !Number.isFinite(itemId)) return null;

  const cached = itemIconCache.get(itemId);
  if (cached !== undefined) return cached;

  const itemDisplayName = ITEMS[itemId];
  if (!itemDisplayName) {
    itemIconCache.set(itemId, null);
    return null;
  }

  const fileName = preferredItemIconFile(itemDisplayName);
  const webPath = fileName ? `/api/item-icons/${encodeURIComponent(fileName)}` : null;

  itemIconCache.set(itemId, webPath);
  return webPath;
}
