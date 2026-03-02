import { HERO_ASSETS_BY_ID } from "./heroAssets.generated";
import { HEROES } from "./deadlockData";
import fs from "node:fs";
import path from "node:path";

const iconExistsCache = new Map<string, boolean>();
const renderFileNameCache = new Map<string, string | null>();

function iconFileExists(webPath: string | null) {
  if (!webPath) return false;

  const cached = iconExistsCache.get(webPath);
  if (cached != null) return cached;

  const diskPath = path.join(process.cwd(), "public", webPath.replace(/^\//, ""));
  const exists = fs.existsSync(diskPath);
  iconExistsCache.set(webPath, exists);
  return exists;
}

function normalizeHeroFolderName(name: string) {
  return name
    .replace(/&/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function heroFolderFromId(heroId: number) {
  const heroName = HEROES[heroId];
  if (!heroName) return null;
  const folder = normalizeHeroFolderName(heroName);
  return folder || null;
}

function fallbackSmallIconPath(heroId: number) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;

  const diskPath = path.join(process.cwd(), "deadlock_hero_images", folder, "icon_image_small.png");
  if (!fs.existsSync(diskPath)) return null;

  return `/api/hero-images/${encodeURIComponent(folder)}/icon_image_small.png`;
}

function fallbackHeroAssetPath(heroId: number, fileName: string) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;

  const diskPath = path.join(process.cwd(), "deadlock_hero_images", folder, fileName);
  if (!fs.existsSync(diskPath)) return null;

  return `/api/hero-images/${encodeURIComponent(folder)}/${fileName}`;
}

function fallbackHeroRenderPath(heroId: number) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;

  const cached = renderFileNameCache.get(folder);
  if (cached !== undefined) {
    if (!cached) return null;
    return `/api/hero-images/${encodeURIComponent(folder)}/${encodeURIComponent(cached)}`;
  }

  const dirPath = path.join(process.cwd(), "deadlock_hero_images", folder);

  let renderFileName: string | null = null;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const file = entries.find((entry) => entry.isFile() && /_Render\.png$/i.test(entry.name));
    renderFileName = file?.name ?? null;
  } catch {
    renderFileName = null;
  }

  renderFileNameCache.set(folder, renderFileName);
  if (!renderFileName) return null;
  return `/api/hero-images/${encodeURIComponent(folder)}/${encodeURIComponent(renderFileName)}`;
}

export function heroSmallIconPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.icon_image_small?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;
  return fallbackSmallIconPath(id);
}

function heroAssetPath(heroId: string | null | undefined, field: string) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.[field]?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;

  if (field === "background_image") {
    return fallbackHeroAssetPath(id, "background_image.png");
  }

  if (field === "icon_hero_card") {
    return fallbackHeroAssetPath(id, "icon_hero_card.png");
  }

  return null;
}

export function heroBackgroundPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "background_image");
}

export function heroRenderPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  return fallbackHeroRenderPath(id);
}

export function heroCardIconPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "icon_hero_card");
}
