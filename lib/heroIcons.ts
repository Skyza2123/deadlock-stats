import { HERO_ASSETS_BY_ID } from "./heroAssets.generated";
import { HEROES } from "./deadlockData";
import fs from "node:fs";
import path from "node:path";

const iconExistsCache = new Map<string, boolean>();
const renderFileNameCache = new Map<string, string>();
const DEADLOCK_ASSET_BASE = "https://assets-bucket.deadlock-api.com/assets-api-res/images";

function externalAssetUrlFromWebPath(webPath: string | null) {
  if (!webPath) return null;
  const normalized = webPath.replace(/^\/+/, "");
  const relative = normalized.startsWith("assets/") ? normalized.slice("assets/".length) : normalized;
  if (!relative) return null;
  return `${DEADLOCK_ASSET_BASE}/${relative}`;
}

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
  return `/api/hero-images/${encodeURIComponent(folder)}/icon_image_small.png`;
}

function fallbackHeroAssetPath(heroId: number, fileName: string) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;
  return `/api/hero-images/${encodeURIComponent(folder)}/${fileName}`;
}

function fallbackHeroRenderPath(heroId: number) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;

  const cached = renderFileNameCache.get(folder);
  if (cached !== undefined) {
    return `/api/hero-images/${encodeURIComponent(folder)}/${encodeURIComponent(cached)}`;
  }

  const renderFileName = `${folder}_Render.png`;
  renderFileNameCache.set(folder, renderFileName);
  return `/api/hero-images/${encodeURIComponent(folder)}/${encodeURIComponent(renderFileName)}`;
}

export function heroSmallIconPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.icon_image_small?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;
  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;
  return fallbackSmallIconPath(id);
}

function heroAssetPath(heroId: string | null | undefined, field: string) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.[field]?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;
  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;

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
