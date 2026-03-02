// lib/heroIcons.client.ts
import { HERO_ASSETS_BY_ID } from "./heroAssets.generated";
import { HEROES } from "./deadlockData";

const USE_PUBLIC_HERO_ASSETS = process.env.NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS === "1";

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

// Client-safe fallback: just point at your API route.
// (No disk checks here—API route should return 404 if missing.)
function fallbackSmallIconPath(heroId: number) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;
  return `/api/hero-images/${encodeURIComponent(folder)}/icon_image_small.png`;
}

function fallbackHeroAssetPath(heroId: number, fileName: string) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;
  return `/api/hero-images/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`;
}

function fallbackHeroRenderPath(heroId: number) {
  const folder = heroFolderFromId(heroId);
  if (!folder) return null;
  // If your API route supports "render.png" aliasing, use that.
  // If not, keep your existing server-side render filename discovery (see server file below).
  return `/api/hero-images/${encodeURIComponent(folder)}/render.png`;
}

export function heroSmallIconPath(heroId: string | null | undefined) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;

  if (USE_PUBLIC_HERO_ASSETS) {
    const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.icon_image_small?.webPath ?? null;
    if (webPath) return webPath;
  }

  return fallbackSmallIconPath(id);
}

function heroAssetPath(heroId: string | null | undefined, field: string) {
  if (!heroId) return null;
  const id = Number(heroId);
  if (!Number.isFinite(id)) return null;

  if (USE_PUBLIC_HERO_ASSETS) {
    const webPath = HERO_ASSETS_BY_ID[id]?.iconFields?.[field]?.webPath ?? null;
    if (webPath) return webPath;
  }

  if (field === "background_image") return fallbackHeroAssetPath(id, "background_image.png");
  if (field === "icon_hero_card") return fallbackHeroAssetPath(id, "icon_hero_card.png");

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
  return fallbackHeroRenderPath(id);
}