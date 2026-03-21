import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroFolder: string }> }
) {
  const { heroFolder } = await params;

  if (!/^[a-zA-Z0-9_]+$/.test(heroFolder)) {
    return new Response("Invalid hero folder", { status: 400 });
  }

  const renderPath = path.join(
    process.cwd(),
    "deadlock_hero_images",
    heroFolder,
    `${heroFolder}_Render.png`
  );

  try {
    const data = await readFile(renderPath);
    return new Response(data, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
