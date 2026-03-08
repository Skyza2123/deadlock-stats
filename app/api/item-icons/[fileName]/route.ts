import fs from "node:fs/promises";
import path from "node:path";

function contentType(fileName: string) {
  if (fileName.endsWith(".png")) return "image/png";
  return "image/webp";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> }
) {
  const { fileName } = await params;

  if (!/^[a-zA-Z0-9_-]+\.(webp|png)$/.test(fileName)) {
    return new Response("Invalid file", { status: 400 });
  }

  const preferredPath = path.join(process.cwd(), "deadlock_icons", fileName);
  const fallbackFileName = fileName.endsWith(".webp")
    ? fileName.replace(/\.webp$/i, ".png")
    : fileName.endsWith(".png")
      ? fileName.replace(/\.png$/i, ".webp")
      : fileName;
  const fallbackPath = path.join(process.cwd(), "deadlock_icons", fallbackFileName);

  try {
    let data: Buffer;
    let servedFileName = fileName;

    try {
      data = await fs.readFile(preferredPath);
    } catch {
      data = await fs.readFile(fallbackPath);
      servedFileName = fallbackFileName;
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentType(servedFileName),
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
