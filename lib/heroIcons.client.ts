// lib/heroIcons.client.ts
import { HERO_ASSETS_BY_ID } from "./heroAssets.generated";

const USE_PUBLIC_HERO_ASSETS = process.env.NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS === "1";
const DEADLOCK_ASSET_BASE = "https://assets-bucket.deadlock-api.com/assets-api-res/images";

function externalAssetUrlFromWebPath(webPath: string | null) {
  if (!webPath) return null;
  const normalized = webPath.replace(/^\/+/, "");
  const relative = normalized.startsWith("assets/") ? normalized.slice("assets/".length) : normalized;
  if (!relative) return null;
  return `${DEADLOCK_ASSET_BASE}/${relative}`;
}

export function heroSmallIconPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;

  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.icon_image_small?.webPath ?? null;
  if (USE_PUBLIC_HERO_ASSETS && webPath) return webPath;

  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;

  return null;
}

function heroAssetPath(heroId: string | null | undefined, field: string) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;

  const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.[field]?.webPath ?? null;
  if (USE_PUBLIC_HERO_ASSETS && webPath) return webPath;

  const external = externalAssetUrlFromWebPath(webPath);
  if (external) return external;

  return null;
}

export function heroBackgroundPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "background_image");
}

export function heroCardIconPath(heroId: string | null | undefined) {
  return heroAssetPath(heroId, "icon_hero_card");
}

export function heroRenderPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;
  return heroAssetPath(heroId, "icon_hero_card") ?? heroAssetPath(heroId, "background_image");
}
