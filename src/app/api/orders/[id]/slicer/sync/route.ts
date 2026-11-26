import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getOrderById, updateOrderStatus } from "@/services/orders";
import { getActiveSlicerSessionInfo } from "@/lib/slicer-embed";
import {
  findLatestExportedGcodeSince,
  parsePrusaGcodeMetadata,
} from "@/lib/gcode-parser";

export const dynamic = "force-dynamic";

/**
 * Détecte en temps réel tout fichier `.gcode` ou `.bgcode` exporté par l'opérateur
 * depuis ses propres changements dans le PrusaSlicer intégré au centre,
 * et renvoie automatiquement le poids PLA exact + paramètres.
 */
export async function GET(
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

    const session = getActiveSlicerSessionInfo();

    // Si cette commande est actuellement ouverte dans PrusaSlicer, on cherche
    // un export effectué après l'ouverture de la pièce.
    if (session.activeOrderId === id) {
      const latest = await findLatestExportedGcodeSince(
        session.sessionOpenedAtMs
      );
      if (latest) {
        if (order.gcodeFilename !== latest.filename) {
          await updateOrderStatus(id, order.status, {
            gcodeFilename: latest.filename,
          }).catch(() => {});
        }
        return NextResponse.json({
          synced: true,
          slice: latest,
        });
      }
    }

    // Sinon, si la commande possède déjà un gcodeFilename enregistré, on lit ses métadonnées
    if (order.gcodeFilename) {
      const existingPath = path.resolve(
        process.cwd(),
        "data",
        "gcode",
        order.gcodeFilename
      );
      const parsed = await parsePrusaGcodeMetadata(existingPath);
      if (parsed) {
        return NextResponse.json({
          synced: true,
          slice: parsed,
        });
      }
    }

    return NextResponse.json({ synced: false, slice: null });
  } catch (error) {
    return NextResponse.json(
      {
        synced: false,
        error: error instanceof Error ? error.message : "Erreur sync G-code",
      },
      { status: 500 }
    );
  }
}
