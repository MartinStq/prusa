import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getOrderById } from "@/services/orders";
import { loadOrderInEmbeddedPrusaSlicer } from "@/lib/slicer-embed";

export async function POST(
  _request: NextRequest,
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

    await loadOrderInEmbeddedPrusaSlicer({
      stlAbsolutePath: resolvedPath,
      stlFilename: order.stlFilename,
      forceReload: true,
    });

    return NextResponse.json({
      ok: true,
      message: `${order.stlFilename} chargé dans PrusaSlicer intégré.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger le STL dans PrusaSlicer.",
      },
      { status: 500 }
    );
  }
}
