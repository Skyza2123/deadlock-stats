import fs from "node:fs";
import path from "node:path";
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

function findItemIconFile(itemDisplayName: string) {
  const candidates = candidateBaseNames(itemDisplayName);

  for (const baseName of candidates) {
    for (const extension of ["webp", "png"] as const) {
      const fileName = `${baseName}.${extension}`;
      const diskPath = path.join(process.cwd(), "deadlock_icons", fileName);
      if (fs.existsSync(diskPath)) {
        return fileName;
      }
    }
  }

  return null;
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

  const fileName = findItemIconFile(itemDisplayName);
  const webPath = fileName ? `/api/item-icons/${encodeURIComponent(fileName)}` : null;

  itemIconCache.set(itemId, webPath);
  return webPath;
}
