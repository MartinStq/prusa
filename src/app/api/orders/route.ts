import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { createOrder, getOrders } from "@/services/orders";
import { ORDER_STATUSES, type OrderStatus } from "@/types/orders";

export async function GET(request: NextRequest) {
  try {
    const statusParam = request.nextUrl.searchParams.get("status");
    const status =
      statusParam && ORDER_STATUSES.includes(statusParam as OrderStatus)
        ? (statusParam as OrderStatus)
        : undefined;

    const orders = await getOrders(status ? { status } : undefined);
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de la récupération des demandes.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const clientName = String(formData.get("clientName") ?? "").trim();
    const clientEmail = String(formData.get("clientEmail") ?? "").trim();
    const file = formData.get("file");

    if (!clientName || !clientEmail) {
      return NextResponse.json(
        { error: "Le nom et l'e-mail du client sont obligatoires." },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Veuillez joindre un fichier .stl valide." },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name).toLowerCase();
    if (ext !== ".stl") {
      return NextResponse.json(
        { error: "Seuls les fichiers .stl sont acceptés." },
        { status: 400 }
      );
    }

    const stlDir = path.join(process.cwd(), "data", "stl");
    await fs.mkdir(stlDir, { recursive: true });

    const cleanBase = path
      .basename(file.name, ext)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 60);
    const savedFilename = `${Date.now()}_${cleanBase || "piece"}.stl`;
    const diskPath = path.join(stlDir, savedFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(diskPath, buffer);

    const order = await createOrder({
      clientName,
      clientEmail,
      stlFilename: file.name,
      stlPath: `./data/stl/${savedFilename}`,
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de la création de la demande.",
      },
      { status: 500 }
    );
  }
}
