import { HERO_ASSETS_BY_ID } from "@/lib/heroAssets.generated";
import { HEROES } from "@/lib/deadlockData";

const DEADLOCK_ASSET_BASE = "https://assets-bucket.deadlock-api.com/assets-api-res/images";

function normalizeHeroFolderName(name: string) {
  return name
    .replace(/&/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const HERO_ID_BY_FOLDER = new Map<string, number>(
  Object.entries(HEROES)
    .map(([heroId, heroName]) => [normalizeHeroFolderName(heroName), Number(heroId)] as const)
    .filter(([folder, heroId]) => Boolean(folder) && Number.isFinite(heroId))
);

function externalAssetUrlFromWebPath(webPath: string | null) {
  if (!webPath) return null;
  const normalized = webPath.replace(/^\/+/, "");
  const relative = normalized.startsWith("assets/") ? normalized.slice("assets/".length) : normalized;
  if (!relative) return null;
  return `${DEADLOCK_ASSET_BASE}/${relative}`;
}

function fileCandidates(requestedFileName: string) {
  const candidates = new Set<string>([requestedFileName]);
  if (!requestedFileName.includes(".")) {
    candidates.add(`${requestedFileName}.png`);
    candidates.add(`${requestedFileName}.webp`);
  }
  return candidates;
}

function resolveAssetUrl(heroId: number, requestedFileName: string) {
  const iconFields = HERO_ASSETS_BY_ID[heroId]?.iconFields;
  if (!iconFields) return null;

  const candidates = fileCandidates(requestedFileName);
  for (const fieldAsset of Object.values(iconFields)) {
    const webPath = fieldAsset?.webPath ?? null;
    if (!webPath) continue;
    const fileName = webPath.split("/").pop();
    if (!fileName) continue;
    if (candidates.has(fileName)) {
      return externalAssetUrlFromWebPath(webPath);
    }
  }

  if (requestedFileName === "render.png") {
    for (const fieldAsset of Object.values(iconFields)) {
      const webPath = fieldAsset?.webPath ?? null;
      if (!webPath) continue;
      const fileName = webPath.split("/").pop() ?? "";
      if (/_Render\.png$/i.test(fileName)) {
        return externalAssetUrlFromWebPath(webPath);
      }
    }
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroFolder: string; fileName: string }> }
) {
  const { heroFolder, fileName: rawFileName } = await params;
  const fileName = decodeURIComponent(rawFileName);

  if (!/^[a-zA-Z0-9_]+$/.test(heroFolder)) {
    return new Response("Invalid hero folder", { status: 400 });
  }

  const heroId = HERO_ID_BY_FOLDER.get(heroFolder);
  if (!heroId) {
    return new Response("Not found", { status: 404 });
  }

  const assetUrl = resolveAssetUrl(heroId, fileName);
  if (!assetUrl) {
    return new Response("Not found", { status: 404 });
  }

  return Response.redirect(assetUrl, 307);
}
