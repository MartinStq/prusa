import { NextRequest, NextResponse } from "next/server";
import {
  fetchPrusaStatus,
  setMockPrinterState,
  isPrusaMockEnabled,
  setPrusaMockMode,
} from "@/lib/prusalink";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await fetchPrusaStatus();
  return NextResponse.json(status);
}

/**
 * Permet de basculer à chaud entre le mode simulation (`mock`) et la vraie Prusa MK4,
 * ou de réinitialiser le plateau simulé à IDLE.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  if (typeof body.mock === "boolean") {
    setPrusaMockMode(body.mock);
  }

  if (
    isPrusaMockEnabled() &&
    (body.state === "IDLE" || body.state === "FINISHED")
  ) {
    await setMockPrinterState(body.state);
  }

  const status = await fetchPrusaStatus();
  return NextResponse.json(status);
}
