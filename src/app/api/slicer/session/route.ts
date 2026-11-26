import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getOrderById } from "@/services/orders";
import { loadOrderInEmbeddedPrusaSlicer } from "@/lib/slicer-embed";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId ?? "").trim();
    const forceReload = Boolean(body.forceReload);

    if (!orderId) {
      return NextResponse.json(
        { error: "Identifiant de la demande (orderId) requis." },
        { status: 400 }
      );
    }

    const order = await getOrderById(orderId);
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
        { error: "Chemin STL non autorisé." },
        { status: 403 }
      );
    }

    const { reloaded } = await loadOrderInEmbeddedPrusaSlicer({
      orderId,
      stlAbsolutePath: resolvedPath,
      stlFilename: order.stlFilename,
      forceReload,
    });

    return NextResponse.json({
      ok: true,
      reloaded,
      stlFilename: order.stlFilename,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors du démarrage de PrusaSlicer intégré.",
      },
      { status: 500 }
    );
  }
}
