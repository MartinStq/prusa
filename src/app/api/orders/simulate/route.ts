import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { createOrder } from "@/services/orders";
import { ensureSampleStlsOnDisk, SAMPLE_STLS } from "@/lib/stl-samples";

const SIMULATED_CLIENTS = [
  { name: "Camille Renard", email: "camille.renard@atelier-sud.be" },
  { name: "Lucas De Smet", email: "lucas.desmet@fablab-bruxelles.be" },
  { name: "Emma Lambert", email: "emma.lambert@design-lille.fr" },
  { name: "Hugo Willems", email: "h.willems@proto-indus.be" },
  { name: "Léa Janssens", email: "lea.janssens@studio-forma.be" },
  { name: "Nathan Claessens", email: "n.claessens@maker-namur.be" },
  { name: "Chloé Maes", email: "chloe.maes@objet3d.be" },
  { name: "Antoine Mertens", email: "a.mertens@meca-liege.be" },
];

let roundRobinIndex = 0;

function pickNextClientAndStl() {
  const client = SIMULATED_CLIENTS[roundRobinIndex % SIMULATED_CLIENTS.length];
  const stl = SAMPLE_STLS[(roundRobinIndex + 3) % SAMPLE_STLS.length];
  roundRobinIndex += 1;
  return { client, stl };
}

export async function POST(request: NextRequest) {
  try {
    ensureSampleStlsOnDisk();
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode ?? "single");

    if (mode === "clear" || mode === "reset") {
      await prisma.printRequest.deleteMany();

      // Nettoie aussi les fichiers .gcode/.bgcode temporaires dans data/gcode/
      const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
      const entries = await fs.readdir(gcodeDir).catch(() => []);
      for (const name of entries) {
        const ext = path.extname(name).toLowerCase();
        if (ext === ".gcode" || ext === ".bgcode") {
          await fs.unlink(path.join(gcodeDir, name)).catch(() => {});
        }
      }

      return NextResponse.json({ mode: "clear", orders: [] });
    }

    const count =
      mode === "batch"
        ? Math.min(5, Math.max(1, Number(body.count ?? 3)))
        : 1;

    const created = [];
    for (let i = 0; i < count; i++) {
      const { client, stl } = pickNextClientAndStl();
      const order = await createOrder({
        clientName: client.name,
        clientEmail: client.email,
        stlFilename: stl.filename,
        stlPath: `./data/stl/${stl.filename}`,
      });
      created.push(order);
    }

    return NextResponse.json({ mode, created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de la simulation de demandes.",
      },
      { status: 500 }
    );
  }
}
