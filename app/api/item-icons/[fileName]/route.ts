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

  const diskPath = path.join(process.cwd(), "deadlock_icons", fileName);

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
