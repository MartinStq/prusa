import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await context.params;
    const novncRoot = path.resolve(
      process.cwd(),
      "node_modules",
      "@novnc",
      "novnc"
    );
    const absPath = path.resolve(novncRoot, ...slug);

    if (!absPath.startsWith(novncRoot + path.sep)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const content = await fs.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
