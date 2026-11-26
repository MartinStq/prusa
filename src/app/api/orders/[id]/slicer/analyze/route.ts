import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getOrderById } from "@/services/orders";
import { analyzeStlWithPrusaSlicer } from "@/lib/slicer";

export async function POST(
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

    const body = await request.json().catch(() => ({}));
    const analysis = await analyzeStlWithPrusaSlicer({
      stlAbsolutePath: resolvedPath,
      infillPercent:
        typeof body.infillPercent === "number" ? body.infillPercent : 15,
      supports: Boolean(body.supports),
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors du tranchage PLA avec PrusaSlicer.",
      },
      { status: 500 }
    );
  }
}
