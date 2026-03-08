import fs from "node:fs/promises";
import path from "node:path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroFolder: string }> }
) {
  const { heroFolder } = await params;

  if (!/^[a-zA-Z0-9_]+$/.test(heroFolder)) {
    return new Response("Invalid hero folder", { status: 400 });
  }

  const candidates = [
    `${heroFolder}_Render.png`,
    `${heroFolder.replace(/_/g, "_&_")}_Render.png`,
    `${heroFolder.replace(/_/g, " ")}_Render.png`,
  ];

  for (const fileName of candidates) {
    const diskPath = path.join(process.cwd(), "deadlock_hero_images", heroFolder, fileName);
    try {
      const data = await fs.readFile(diskPath);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800, immutable",
        },
      });
    } catch {
      // try next candidate
    }
  }

  try {
    const dirPath = path.join(process.cwd(), "deadlock_hero_images", heroFolder);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const renderFile = entries.find((entry) => entry.isFile() && /_Render\.png$/i.test(entry.name));
    if (!renderFile) return new Response("Not found", { status: 404 });

    const data = await fs.readFile(path.join(dirPath, renderFile.name));
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
