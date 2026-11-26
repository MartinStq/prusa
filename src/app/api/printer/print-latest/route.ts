import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getOrderById } from "@/services/orders";
import { uploadGcodeAndStartPrint } from "@/lib/prusalink";

/**
 * Sélectionne le fichier .gcode/.bgcode correspondant à cette commande
 * (en priorité celui synchronisé pour cette commande, puis le plus récent portant le même préfixe STL)
 * et l'envoie directement sur la Prusa MK4.
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

    const stlBase = path
      .basename(order.stlFilename, path.extname(order.stlFilename))
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .toLowerCase();

    const candidates: {
      name: string;
      mtimeMs: number;
      fullPath: string;
      matchesStl: boolean;
    }[] = [];

    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (ext !== ".gcode" && ext !== ".bgcode") continue;
      const fullPath = path.join(gcodeDir, name);
      const st = await fs.stat(fullPath).catch(() => null);
      if (!st || !st.isFile()) continue;
      candidates.push({
        name,
        mtimeMs: st.mtimeMs,
        fullPath,
        matchesStl: name.toLowerCase().startsWith(stlBase),
      });
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // 1. Fichier correspondant à la pièce de la commande (le plus récent)
    // 2. Sinon le gcodeFilename déjà lié à la commande s'il existe dans data/gcode
    // 3. Sinon le tout dernier export dans data/gcode
    const chosen =
      candidates.find((c) => c.matchesStl) ??
      (order.gcodeFilename
        ? candidates.find((c) => c.name === order.gcodeFilename)
        : undefined) ??
      candidates[0] ??
      null;

    if (!chosen) {
      return NextResponse.json(
        {
          error:
            "Aucun fichier .gcode ou .bgcode trouvé dans ./data/gcode/. Cliquez d'abord sur « Trancher maintenant » puis « Exporter le G-code » dans PrusaSlicer au centre.",
        },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(chosen.fullPath);
    const result = await uploadGcodeAndStartPrint({
      orderId,
      originalFilename: chosen.name,
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
