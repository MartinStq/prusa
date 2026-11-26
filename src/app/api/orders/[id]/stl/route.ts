import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getOrderById } from "@/services/orders";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const order = await getOrderById(id);

    if (!order) {
      return NextResponse.json(
        { error: "Demande introuvable." },
        { status: 404 }
      );
    }

    const stlBaseDir = path.resolve(process.cwd(), "data", "stl");
    const resolvedPath = path.resolve(process.cwd(), order.stlPath);

    if (
      !resolvedPath.startsWith(stlBaseDir + path.sep) &&
      resolvedPath !== stlBaseDir
    ) {
      return NextResponse.json(
        { error: "Chemin de fichier STL non autorisé." },
        { status: 403 }
      );
    }

    const fileBuffer = await fs.readFile(resolvedPath);
    const isDownload = request.nextUrl.searchParams.get("download") === "1";

    const safeDownloadName = order.stlFilename.replace(/["\r\n]/g, "_");

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": "model/stl",
        "Content-Length": String(fileBuffer.byteLength),
        "Content-Disposition": isDownload
          ? `attachment; filename="${safeDownloadName}"`
          : `inline; filename="${safeDownloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Impossible de lire le fichier STL : ${error.message}`
            : "Fichier STL introuvable sur le disque.",
      },
      { status: 404 }
    );
  }
}
