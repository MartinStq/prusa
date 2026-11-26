import { NextRequest, NextResponse } from "next/server";
import {
  getOrderById,
  updateOrderDecision,
  updateOrderStatus,
} from "@/services/orders";
import { setMockPrinterState, isPrusaMockEnabled } from "@/lib/prusalink";
import {
  ORDER_STATUSES,
  ORDER_VERDICTS,
  type OrderStatus,
  type OrderVerdict,
} from "@/types/orders";

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
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erreur interne serveur.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    if (body.action === "decision") {
      const verdict = body.verdict as OrderVerdict;
      if (!ORDER_VERDICTS.includes(verdict)) {
        return NextResponse.json(
          { error: "Verdict invalide." },
          { status: 400 }
        );
      }

      const order = await updateOrderDecision(id, {
        verdict,
        weightGrams:
          body.weightGrams !== undefined && body.weightGrams !== null
            ? Number(body.weightGrams)
            : null,
        operatorComment: body.operatorComment ?? null,
        needsDesignerMeeting: Boolean(body.needsDesignerMeeting),
        improvementAction: body.improvementAction,
      });

      return NextResponse.json({ order });
    }

    if (body.action === "status") {
      const status = body.status as OrderStatus;
      if (!ORDER_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: "Statut invalide." },
          { status: 400 }
        );
      }

      const order = await updateOrderStatus(id, status, {
        gcodeFilename: body.gcodeFilename,
        invoiced: body.invoiced,
      });

      if (status === "FINISHED" && isPrusaMockEnabled()) {
        await setMockPrinterState("FINISHED");
      }

      return NextResponse.json({ order });
    }

    return NextResponse.json(
      { error: "Action non reconnue (attendu: 'decision' ou 'status')." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur lors de la mise à jour de la demande.",
      },
      { status: 400 }
    );
  }
}
