import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED_FILES = new Set([
  "icon_image_small.png",
  "icon_image_small_webp.webp",
  "icon_hero_card.png",
  "icon_hero_card_webp.webp",
  "minimap_image.png",
  "minimap_image_webp.webp",
  "top_bar_vertical_image.png",
  "top_bar_vertical_image_webp.webp",
  "background_image.png",
  "background_image_webp.webp",
  "hero_card_critical.png",
  "hero_card_critical_webp.webp",
  "hero_card_gloat.png",
  "hero_card_gloat_webp.webp",
  "name_image",
]);

function isAllowedRenderFile(fileName: string) {
  return /^[a-zA-Z0-9_&-]+_Render\.png$/.test(fileName);
}

function contentType(fileName: string) {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/svg+xml";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroFolder: string; fileName: string }> }
) {
  const { heroFolder, fileName } = await params;

  if (!/^[a-zA-Z0-9_]+$/.test(heroFolder)) {
    return new Response("Invalid hero folder", { status: 400 });
  }

  if (!ALLOWED_FILES.has(fileName) && !isAllowedRenderFile(fileName)) {
    return new Response("File not allowed", { status: 404 });
  }

  const diskPath = path.join(process.cwd(), "deadlock_hero_images", heroFolder, fileName);

  try {
    const data = await fs.readFile(diskPath);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": contentType(fileName),
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
