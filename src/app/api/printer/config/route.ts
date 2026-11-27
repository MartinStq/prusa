import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchPrusaStatus,
  isPrusaMockEnabled,
  setPrusaMockMode,
} from "@/lib/prusalink";

export const dynamic = "force-dynamic";

function sanitizeEnvValue(value: string): string {
  return value.replace(/[\r\n"]/g, "").trim();
}

export async function GET() {
  return NextResponse.json({
    prusaIp: process.env.PRUSA_IP ?? "",
    prusaHostname: process.env.PRUSA_HOSTNAME ?? "prusa-mk4",
    prusaUser: process.env.PRUSA_USER ?? "maker",
    hasApiKey: Boolean(process.env.PRUSA_API_KEY?.trim()),
    mock: isPrusaMockEnabled(),
  });
}

/**
 * Met à jour PRUSA_IP / PRUSA_USER / PRUSA_API_KEY / PRUSA_MOCK à chaud
 * et persiste dans le fichier .env local sans avoir à redémarrer le serveur.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const nextIp = sanitizeEnvValue(String(body.prusaIp ?? process.env.PRUSA_IP ?? ""));
    const nextHostname = sanitizeEnvValue(
      String(body.prusaHostname ?? process.env.PRUSA_HOSTNAME ?? "prusa-mk4")
    );
    const nextUser = sanitizeEnvValue(
      String(body.prusaUser ?? process.env.PRUSA_USER ?? "maker")
    );
    const rawKey = typeof body.prusaApiKey === "string" ? body.prusaApiKey.trim() : "";
    const nextKey = rawKey
      ? sanitizeEnvValue(rawKey)
      : sanitizeEnvValue(process.env.PRUSA_API_KEY ?? "");
    const nextMock =
      typeof body.mock === "boolean" ? body.mock : isPrusaMockEnabled();

    // Application immédiate en mémoire
    process.env.PRUSA_IP = nextIp;
    process.env.PRUSA_HOSTNAME = nextHostname;
    process.env.PRUSA_USER = nextUser;
    process.env.PRUSA_API_KEY = nextKey;
    process.env.PRUSA_MOCK = nextMock ? "true" : "false";
    setPrusaMockMode(nextMock);

    // Persistance dans .env en préservant DATABASE_URL
    const envPath = path.resolve(process.cwd(), ".env");
    const dbUrl = sanitizeEnvValue(process.env.DATABASE_URL || "file:./dev.db");
    const envLines = [
      `DATABASE_URL="${dbUrl}"`,
      `PRUSA_IP="${nextIp}"`,
      `PRUSA_HOSTNAME="${nextHostname}"`,
      `PRUSA_USER="${nextUser}"`,
      `PRUSA_API_KEY="${nextKey}"`,
      `PRUSA_MOCK="${nextMock ? "true" : "false"}"`,
      "",
    ].join("\n");

    await fs.writeFile(envPath, envLines, "utf-8");

    const status = await fetchPrusaStatus();
    return NextResponse.json({
      ok: true,
      config: {
        prusaIp: nextIp,
        prusaHostname: nextHostname,
        prusaUser: nextUser,
        hasApiKey: Boolean(nextKey),
        mock: nextMock,
      },
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible d'enregistrer le fichier .env.",
      },
      { status: 500 }
    );
  }
}
