import { NextRequest, NextResponse } from "next/server";
import { getOrderById } from "@/services/orders";
import { uploadGcodeAndStartPrint } from "@/lib/prusalink";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const orderId = String(formData.get("orderId") ?? "").trim();
    const file = formData.get("file");

    if (!orderId) {
      return NextResponse.json(
        { error: "Identifiant de la demande (orderId) manquant." },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Veuillez fournir un fichier .gcode ou .bgcode." },
        { status: 400 }
      );
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json(
        { error: "Demande d'impression introuvable." },
        { status: 404 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadGcodeAndStartPrint({
      orderId,
      originalFilename: file.name,
      fileBuffer,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de l'envoi du G-code à la Prusa.",
      },
      { status: 500 }
    );
  }
}
