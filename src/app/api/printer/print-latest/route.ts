import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getOrderById } from "@/services/orders";
import { uploadGcodeAndStartPrint } from "@/lib/prusalink";

/**
 * Récupère le fichier .gcode ou .bgcode le plus récemment exporté depuis le PrusaSlicer intégré
 * dans ./data/gcode/ et le lance directement sur la Prusa MK4.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId ?? "").trim();

    if (!orderId) {
      return NextResponse.json(
        { error: "Identifiant de la demande (orderId) manquant." },
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

    const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
    await fs.mkdir(gcodeDir, { recursive: true });
    const entries = await fs.readdir(gcodeDir);

    let newest: { name: string; mtimeMs: number; fullPath: string } | null =
      null;

    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (ext !== ".gcode" && ext !== ".bgcode") continue;
      const fullPath = path.join(gcodeDir, name);
      const st = await fs.stat(fullPath).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { name, mtimeMs: st.mtimeMs, fullPath };
      }
    }

    if (!newest) {
      return NextResponse.json(
        {
          error:
            "Aucun fichier .gcode ou .bgcode trouvé dans ./data/gcode/. Cliquez d'abord sur 'Exporter le G-code' dans PrusaSlicer au centre (ou glissez un fichier ci-dessous).",
        },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(newest.fullPath);
    const result = await uploadGcodeAndStartPrint({
      orderId,
      originalFilename: newest.name,
      fileBuffer,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de l'envoi du G-code exporté.",
      },
      { status: 500 }
    );
  }
}
