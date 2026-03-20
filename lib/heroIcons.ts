import { HERO_ASSETS_BY_ID } from "./heroAssets.generated";
import fs from "node:fs";
import path from "node:path";

const iconExistsCache = new Map<string, boolean>();
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

export function heroSmallIconPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.icon_image_small?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;
  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;
  return null;
}

function heroAssetPath(heroId: string | null | undefined, field: string) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.[field]?.webPath ?? null;
  if (iconFileExists(webPath)) return webPath;
  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;

  return null;
}

export function heroBackgroundPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "background_image");
}

export function heroRenderPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  return heroAssetPath(heroId, "icon_hero_card") ?? heroAssetPath(heroId, "background_image");
}

export function heroCardIconPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "icon_hero_card");
}
